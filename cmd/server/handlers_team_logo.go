package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"
)

var (
	teamLogosOnce sync.Once
	teamLogosMap  map[string]string
	teamLogosErr  error
	teamLogosMu   sync.Mutex
	reSlugParts   = regexp.MustCompile(`[^a-z0-9]+`)
)

func loadTeamLogos(dataDir string) (map[string]string, error) {
	teamLogosOnce.Do(func() {
		teamLogosMap = map[string]string{}
		path := filepath.Join(dataDir, "team_logos.json")
		b, err := os.ReadFile(path) //nolint:gosec
		if err != nil {
			if os.IsNotExist(err) {
				return
			}
			teamLogosErr = err
			return
		}
		var raw map[string]string
		if err := json.Unmarshal(b, &raw); err != nil {
			teamLogosErr = err
			return
		}
		for k, v := range raw {
			key := teamSlug(k)
			if key == "" || strings.TrimSpace(v) == "" {
				continue
			}
			teamLogosMap[key] = strings.TrimSpace(v)
		}
	})
	return teamLogosMap, teamLogosErr
}

func teamSlug(s string) string {
	v := strings.ToLower(strings.TrimSpace(s))
	v = reSlugParts.ReplaceAllString(v, "-")
	v = strings.Trim(v, "-")
	return v
}

func initialsFromSlug(slug string) string {
	parts := strings.Split(strings.TrimSpace(slug), "-")
	out := ""
	for _, p := range parts {
		if p == "" {
			continue
		}
		out += strings.ToUpper(string(p[0]))
		if len(out) >= 3 {
			break
		}
	}
	if out == "" {
		return "TM"
	}
	return out
}

func colorFromSlug(slug string) string {
	h := 0
	for i := 0; i < len(slug); i++ {
		h = (h*31 + int(slug[i])) % 360
	}
	// Slightly muted, dark-friendly.
	return fmt.Sprintf("hsl(%d 55%% 42%%)", h)
}

func writeFallbackTeamLogoSVG(w http.ResponseWriter, slug string) {
	initials := initialsFromSlug(slug)
	bg := colorFromSlug(slug)
	svg := fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="%s"/><text x="48" y="56" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="700" fill="#ffffff">%s</text></svg>`,
		bg, initials,
	)
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write([]byte(svg))
}

func handleTeamLogo(w http.ResponseWriter, r *http.Request, dataDir string) {
	slug := strings.TrimPrefix(r.URL.Path, "/api/team-logo/")
	slug = teamSlug(strings.TrimSpace(strings.TrimRight(slug, "/")))
	if slug == "" {
		writeError(w, http.StatusBadRequest, "missing team slug")
		return
	}

	logos, _ := loadTeamLogos(dataDir)
	logoURL := strings.TrimSpace(logos[slug])
	if logoURL == "" {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}

	cacheDir := filepath.Join(dataDir, "cache", "team_logos")
	cachePath := filepath.Join(cacheDir, slug+".png")
	if b, err := os.ReadFile(cachePath); err == nil && len(b) > 0 { //nolint:gosec
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(b)
		return
	}

	teamLogosMu.Lock()
	defer teamLogosMu.Unlock()
	if b, err := os.ReadFile(cachePath); err == nil && len(b) > 0 { //nolint:gosec
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		_, _ = w.Write(b)
		return
	}

	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Get(logoURL) // #nosec G107 -- URL controlled by local mapping file
	if err != nil {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}

	src, _, err := image.Decode(resp.Body)
	if err != nil {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}

	const outW = 96
	const outH = 96
	dst := image.NewRGBA(image.Rect(0, 0, outW, outH))
	b := src.Bounds()
	sw := b.Dx()
	sh := b.Dy()
	if sw <= 0 || sh <= 0 {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}
	scaleX := float64(outW) / float64(sw)
	scaleY := float64(outH) / float64(sh)
	scale := scaleX
	if scaleY < scale {
		scale = scaleY
	}
	dw := int(float64(sw) * scale)
	dh := int(float64(sh) * scale)
	if dw < 1 {
		dw = 1
	}
	if dh < 1 {
		dh = 1
	}
	dx := (outW - dw) / 2
	dy := (outH - dh) / 2
	draw.CatmullRom.Scale(dst, image.Rect(dx, dy, dx+dw, dy+dh), src, b, draw.Over, nil)

	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&out, dst); err != nil {
		writeFallbackTeamLogoSVG(w, slug)
		return
	}
	if err := os.MkdirAll(cacheDir, 0o750); err == nil {
		_ = os.WriteFile(cachePath, out.Bytes(), 0o600)
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(out.Bytes())
}

