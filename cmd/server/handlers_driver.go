package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/models"
	"golang.org/x/image/draw"
)

type driverProfile struct {
	FullName    string `json:"full_name"`
	BirthDate   string `json:"birth_date"` // YYYY-MM-DD
	BirthPlace  string `json:"birth_place"`
	Citizenship string `json:"citizenship"`
	PhotoURL    string `json:"photo_url"`
}

var (
	driverProfilesMu    sync.RWMutex
	driverProfiles      map[string]driverProfile
	driverProfilesErr   error
	driverProfilesMTime time.Time
	driverThumbsMu      sync.Mutex
)

func loadDriverProfiles(dataDir string) (map[string]driverProfile, error) {
	path := filepath.Join(dataDir, "driver_profiles.json")
	fi, statErr := os.Stat(path)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			driverProfilesMu.Lock()
			driverProfiles = map[string]driverProfile{}
			driverProfilesErr = nil
			driverProfilesMTime = time.Time{}
			driverProfilesMu.Unlock()
			return map[string]driverProfile{}, nil
		}
		driverProfilesMu.RLock()
		defer driverProfilesMu.RUnlock()
		return driverProfiles, statErr
	}

	modTime := fi.ModTime()
	driverProfilesMu.RLock()
	cached := driverProfiles
	cachedErr := driverProfilesErr
	cachedMTime := driverProfilesMTime
	driverProfilesMu.RUnlock()
	if cached != nil && cachedErr == nil && modTime.Equal(cachedMTime) {
		return cached, nil
	}

	b, err := os.ReadFile(path) //nolint:gosec
	if err != nil {
		driverProfilesMu.Lock()
		driverProfilesErr = err
		driverProfilesMu.Unlock()
		return driverProfiles, err
	}
	var m map[string]driverProfile
	if err := json.Unmarshal(b, &m); err != nil {
		driverProfilesMu.Lock()
		driverProfilesErr = err
		driverProfilesMu.Unlock()
		return driverProfiles, err
	}
	if m == nil {
		m = map[string]driverProfile{}
	}
	driverProfilesMu.Lock()
	driverProfiles = m
	driverProfilesErr = nil
	driverProfilesMTime = modTime
	driverProfilesMu.Unlock()
	return m, nil
}

func handleDriversList(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	type driverItem struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	dedupe := map[string]driverItem{}
	add := func(name string) {
		n := strings.TrimSpace(name)
		if n == "" {
			return
		}
		if shouldSkipSearchDriverName(n) {
			return
		}
		s := driverutil.Slug(n)
		if s == "" {
			return
		}
		if old, ok := dedupe[s]; ok {
			if len(strings.TrimSpace(old.Name)) >= len(n) {
				return
			}
		}
		dedupe[s] = driverItem{Name: n, Slug: s}
	}
	addWithSlug := func(name, slug string) {
		n := strings.TrimSpace(name)
		s := strings.TrimSpace(slug)
		if s == "" {
			add(n)
			return
		}
		if n == "" {
			n = strings.ReplaceAll(s, "-", " ")
		}
		if shouldSkipSearchDriverName(n) {
			return
		}
		if old, ok := dedupe[s]; ok {
			if len(strings.TrimSpace(old.Name)) >= len(n) {
				return
			}
		}
		dedupe[s] = driverItem{Name: n, Slug: s}
	}

	if st != nil {
		drivers, err := st.ListDrivers(r.Context())
		if err != nil {
			slog.Warn("list drivers failed", "err", err, "trace_id", TraceID(r.Context()))
		} else {
			for _, d := range drivers {
				add(d.Name)
			}
		}
	}
	profiles, _ := loadDriverProfiles(dataDir)
	for slug, p := range profiles {
		name := strings.TrimSpace(p.FullName)
		addWithSlug(name, slug)
	}

	out := make([]driverItem, 0, len(dedupe))
	for _, v := range dedupe {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	if err := jsonMarshalTo(w, out); err != nil {
		slog.Warn("jsonMarshalTo failed", "endpoint", "/api/drivers", "err", err)
	}
}

func shouldSkipSearchDriverName(name string) bool {
	n := strings.TrimSpace(name)
	if n == "" {
		return true
	}
	// Composite crews should not appear as "driver" entities.
	if strings.Contains(n, "/") || strings.Contains(n, ";") {
		return true
	}
	parts := strings.Fields(n)
	// Single-token surnames/aliases (e.g. "Verstappen") add noise.
	if len(parts) < 2 {
		return true
	}
	// Initial-based aliases (e.g. "M. Verstappen") are noisy duplicates.
	if len(parts) == 2 && strings.HasSuffix(parts[0], ".") {
		return true
	}
	return false
}

// driverFilledScore возвращает количество заполненных полей (nationality, birth_date, birth_place).
func driverFilledScore(d *models.Driver) int {
	n := 0
	if d.Nationality != "" {
		n++
	}
	if !d.BirthDate.IsZero() {
		n++
	}
	if d.BirthPlace != "" {
		n++
	}
	return n
}

func handleDriverBySlug(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	slug := strings.TrimPrefix(r.URL.Path, "/api/driver/")
	slug = strings.TrimRight(slug, "/")
	slug = strings.TrimSpace(slug)
	if slug == "" {
		writeError(w, http.StatusBadRequest, "missing driver slug")
		return
	}

	slug = normalizeDriverSlug(slug)
	profiles, _ := loadDriverProfiles(dataDir)
	slugKey := driverutil.Slug(slug)
	profile, hasProfile := driverProfile{}, false
	if profiles != nil {
		profile, hasProfile = profiles[slugKey]
	}

	season := config.CurrentSeason
	seasonResults, errSeason := schedulefile.BuildDriverSeasonResultsFromEvents(
		dataDir,
		driverutil.Slug(slug),
		season,
	)
	if errSeason != nil {
		slog.Warn("build driver season results from events failed",
			"slug", slug,
			"season", season,
			"err", errSeason,
		)
		seasonResults = nil
	}

	if st == nil {
		if hasProfile {
			writeDriverProfileOnly(w, profile, seasonResults)
			return
		}
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	drivers, err := st.GetDriversBySlug(r.Context(), slug)
	if err != nil {
		slog.Error("get driver by slug failed",
			"slug", slug,
			"err", err,
			"trace_id", TraceID(r.Context()),
		)
		writeError(w, http.StatusInternalServerError, "failed to get driver")
		return
	}
	if len(drivers) == 0 {
		if hasProfile {
			writeDriverProfileOnly(w, profile, seasonResults)
			return
		}
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	// Выбираем запись с максимальным числом заполненных полей (nationality, birth_date, birth_place).
	var found *models.Driver
	for i := range drivers {
		d := &drivers[i]
		if found == nil || driverFilledScore(d) > driverFilledScore(found) {
			found = d
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	birthStr := ""
	if !found.BirthDate.IsZero() {
		birthStr = found.BirthDate.Format("2006-01-02")
	}

	// Накладываем ручные профили (например, для F1).
	// Это позволяет заполнять fields и фото без миграций БД.
	if p, ok := profiles[slugKey]; ok {
		if strings.TrimSpace(p.FullName) != "" {
			found.Name = p.FullName
		}
		if strings.TrimSpace(p.Citizenship) != "" {
			found.Nationality = p.Citizenship
		}
		if strings.TrimSpace(p.BirthPlace) != "" {
			found.BirthPlace = p.BirthPlace
		}
		if strings.TrimSpace(p.BirthDate) != "" {
			if t, err := time.Parse("2006-01-02", p.BirthDate); err == nil {
				found.BirthDate = t
				birthStr = t.Format("2006-01-02")
			}
		}
	}

	resp := map[string]interface{}{
		"name":        found.Name,
		"nationality": found.Nationality,
		// В базе у нас сейчас хранится только nationality, но для UI
		// нужен отдельный блок "Citizenship" (как на примере Transfermarkt).
		// Пока маппим nationality -> citizenship; позже можно будет заменить на отдельное поле.
		"citizenship": found.Nationality,
		"birth_date":  birthStr,
		"birth_place": found.BirthPlace,
		// photo_url может быть загружен из driver_profiles.json
		"photo_url": func() string {
			if profiles == nil {
				return ""
			}
			if p, ok := profiles[slugKey]; ok && strings.TrimSpace(p.PhotoURL) != "" {
				return p.PhotoURL
			}
			return ""
		}(),
		"season":         season,
		"season_results": seasonResults,
	}
	if err := jsonMarshalTo(w, resp); err != nil {
		slog.Warn("jsonMarshalTo failed", "slug", slug, "err", err)
	}
}

func writeDriverProfileOnly(w http.ResponseWriter, p driverProfile, seasonResults []models.DriverSeasonResult) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	resp := map[string]interface{}{
		"name":           strings.TrimSpace(p.FullName),
		"nationality":    strings.TrimSpace(p.Citizenship),
		"citizenship":    strings.TrimSpace(p.Citizenship),
		"birth_date":     strings.TrimSpace(p.BirthDate),
		"birth_place":    strings.TrimSpace(p.BirthPlace),
		"photo_url":      strings.TrimSpace(p.PhotoURL),
		"season":         config.CurrentSeason,
		"season_results": seasonResults,
	}
	_ = jsonMarshalTo(w, resp)
}

func normalizeDriverSlug(slug string) string {
	// Aliases for legacy slugs produced from names with diacritics.
	// Example: "Hülkenberg" might be stored as "h-lkenberg" (ü -> dash),
	// while user-facing URLs may use "hulkenberg" (ü -> u).
	switch strings.ToLower(slug) {
	case "nico-hulkenberg", "nicolas-hulkenberg":
		return "nico-h-lkenberg"
	case "sergio-perez", "sergio-pérez":
		// "Pérez" loses the "é" when slugified (é -> "-"), so DB key becomes "sergio-p-rez".
		return "sergio-p-rez"
	default:
		return slug
	}
}

func getDriverPhotoURL(slug, dataDir string) string {
	profiles, _ := loadDriverProfiles(dataDir)
	if profiles == nil {
		return ""
	}
	slugKey := driverutil.Slug(slug)
	if p, ok := profiles[slugKey]; ok && strings.TrimSpace(p.PhotoURL) != "" {
		return strings.TrimSpace(p.PhotoURL)
	}
	return ""
}

func handleDriverThumbnail(w http.ResponseWriter, r *http.Request, dataDir string) {
	slug := strings.TrimPrefix(r.URL.Path, "/api/driver-thumb/")
	slug = strings.TrimSpace(strings.TrimRight(slug, "/"))
	if slug == "" {
		writeError(w, http.StatusBadRequest, "missing driver slug")
		return
	}
	slug = normalizeDriverSlug(slug)
	photoURL := getDriverPhotoURL(slug, dataDir)
	if photoURL == "" {
		http.NotFound(w, r)
		return
	}

	cacheDir := filepath.Join(dataDir, "cache", "driver_thumbs")
	cachePath := filepath.Join(cacheDir, driverutil.Slug(slug)+".v2.jpg")
	if b, err := os.ReadFile(cachePath); err == nil && len(b) > 0 { //nolint:gosec
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(b)
		return
	}

	driverThumbsMu.Lock()
	defer driverThumbsMu.Unlock()
	if b, err := os.ReadFile(cachePath); err == nil && len(b) > 0 { //nolint:gosec
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(b)
		return
	}

	src, err := loadDriverSourceImage(photoURL, dataDir)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	const outW = 88
	const outH = 112
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		http.NotFound(w, r)
		return
	}
	// Preserve the full source image (contain), avoiding aggressive face/body cropping.
	scale := float64(outW) / float64(srcW)
	if hScale := float64(outH) / float64(srcH); hScale < scale {
		scale = hScale
	}
	drawW := int(float64(srcW) * scale)
	drawH := int(float64(srcH) * scale)
	if drawW < 1 {
		drawW = 1
	}
	if drawH < 1 {
		drawH = 1
	}
	offX := (outW - drawW) / 2
	offY := (outH - drawH) / 2

	dst := image.NewRGBA(image.Rect(0, 0, outW, outH))
	bg := image.NewUniform(color.RGBA{R: 12, G: 14, B: 18, A: 255})
	draw.Draw(dst, dst.Bounds(), bg, image.Point{}, draw.Src)
	dstRect := image.Rect(offX, offY, offX+drawW, offY+drawH)
	draw.CatmullRom.Scale(dst, dstRect, src, bounds, draw.Over, nil)

	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: 90}); err != nil {
		http.NotFound(w, r)
		return
	}
	if err := os.MkdirAll(cacheDir, 0o750); err == nil {
		_ = os.WriteFile(cachePath, out.Bytes(), 0o600)
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(out.Bytes())
}

func loadDriverSourceImage(photoURL, dataDir string) (image.Image, error) {
	raw := strings.TrimSpace(photoURL)
	if raw == "" {
		return nil, os.ErrNotExist
	}
	if isLocalDriverPhoto(raw) {
		localPath := resolveLocalDriverPhotoPath(raw, dataDir)
		f, err := os.Open(localPath) //nolint:gosec
		if err != nil {
			return nil, err
		}
		defer func() { _ = f.Close() }()
		src, _, err := image.Decode(f)
		return src, err
	}

	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(raw) // #nosec G107 -- URL is controlled by local driver profiles
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, os.ErrNotExist
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	src, _, err := image.Decode(bytes.NewReader(body))
	return src, err
}

func isLocalDriverPhoto(v string) bool {
	s := strings.TrimSpace(strings.ToLower(v))
	return strings.HasPrefix(s, "/web/") || strings.HasPrefix(s, "web/") || filepath.IsAbs(v)
}

func resolveLocalDriverPhotoPath(raw, dataDir string) string {
	raw = strings.TrimSpace(raw)
	if u, err := url.PathUnescape(raw); err == nil {
		raw = u
	}
	if filepath.IsAbs(raw) {
		return raw
	}
	repoRoot := filepath.Dir(dataDir)
	raw = strings.TrimPrefix(raw, "/")
	return filepath.Join(repoRoot, filepath.FromSlash(raw))
}

func jsonMarshalTo(w http.ResponseWriter, v interface{}) error {
	err := json.NewEncoder(w).Encode(v)
	if err != nil {
		slog.Warn("json encode failed", "err", err)
	}
	return err
}
