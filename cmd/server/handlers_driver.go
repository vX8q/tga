package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/models"
)

type driverProfile struct {
	FullName    string `json:"full_name"`
	BirthDate   string `json:"birth_date"`   // YYYY-MM-DD
	BirthPlace  string `json:"birth_place"`
	Citizenship  string `json:"citizenship"`
	PhotoURL    string `json:"photo_url"`
}

var (
	driverProfilesOnce sync.Once
	driverProfiles     map[string]driverProfile
	driverProfilesErr  error
)

func loadDriverProfiles(dataDir string) (map[string]driverProfile, error) {
	driverProfilesOnce.Do(func() {
		driverProfiles = nil
		driverProfilesErr = nil

		path := filepath.Join(dataDir, "driver_profiles.json")
		b, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				driverProfiles = map[string]driverProfile{}
				return
			}
			driverProfilesErr = err
			return
		}

		var m map[string]driverProfile
		if err := json.Unmarshal(b, &m); err != nil {
			driverProfilesErr = err
			return
		}
		if m == nil {
			m = map[string]driverProfile{}
		}
		driverProfiles = m
	})

	return driverProfiles, driverProfilesErr
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

	// Aliases for legacy slugs produced from names with diacritics.
	// Example: "Hülkenberg" might be stored as "h-lkenberg" (ü -> dash),
	// while user-facing URLs may use "hulkenberg" (ü -> u).
	switch strings.ToLower(slug) {
	case "nico-hulkenberg", "nicolas-hulkenberg":
		slug = "nico-h-lkenberg"
	case "sergio-perez", "sergio-pérez":
		// "Pérez" loses the "é" when slugified (é -> "-"), so DB key becomes "sergio-p-rez".
		slug = "sergio-p-rez"
	}

	if st == nil {
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

	season := config.CurrentSeason
	// season_results считаем из JSON, чтобы не зависеть от того,
	// как (и что) уже успело импортироваться в SQLite.
	seasonResults, err := schedulefile.BuildDriverSeasonResultsFromEvents(
		dataDir,
		driverutil.Slug(slug),
		season,
	)
	if err != nil {
		slog.Warn("build driver season results from events failed",
			"slug", slug,
			"season", season,
			"err", err,
		)
		seasonResults = nil
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	birthStr := ""
	if !found.BirthDate.IsZero() {
		birthStr = found.BirthDate.Format("2006-01-02")
	}

	// Накладываем ручные профили (например, для F1).
	// Это позволяет заполнять fields и фото без миграций БД.
	profiles, _ := loadDriverProfiles(dataDir)
	slugKey := driverutil.Slug(slug)
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
		"name":           found.Name,
		"nationality":    found.Nationality,
		// В базе у нас сейчас хранится только nationality, но для UI
		// нужен отдельный блок "Citizenship" (как на примере Transfermarkt).
		// Пока маппим nationality -> citizenship; позже можно будет заменить на отдельное поле.
		"citizenship":   found.Nationality,
		"birth_date":     birthStr,
		"birth_place":    found.BirthPlace,
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
	jsonMarshalTo(w, resp)
}

func jsonMarshalTo(w http.ResponseWriter, v interface{}) error {
	err := json.NewEncoder(w).Encode(v)
	if err != nil {
		slog.Warn("json encode failed", "err", err)
	}
	return err
}
