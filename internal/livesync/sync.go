// Package livesync обновляет data/live.json по данным NASCAR и OpenF1 API.
// Используется фоновым циклом в сервере и утилитами cmd/sync-nascar-live, cmd/sync-openf1-live.
package livesync

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/schedulefile"
)

const (
	nascarFeedBase  = "https://feed.nascar.com"
	openF1Base      = "https://api.openf1.org"
	httpTimeout     = 15 * time.Second
	defaultInterval = 2 * time.Minute
)

var nascarSeriesToDataID = map[int]string{
	1: "nascar_cup",
	2: "noaps",
	3: "nascar_truck",
}

var (
	livesyncErrorsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tga_livesync_errors_total",
			Help: "Total number of livesync errors by source and reason.",
		},
		[]string{"source", "reason"},
	)
	livesyncLastSuccess = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "tga_livesync_last_success_unix",
			Help: "Unix timestamp of last successful livesync by source.",
		},
		[]string{"source"},
	)
)

func init() {
	prometheus.MustRegister(livesyncErrorsTotal, livesyncLastSuccess)
}

// Run выполняет синхронизацию NASCAR и OpenF1 по очереди (каждая мержит свой результат в live.json).
func Run(dataDir string) error {
	if err := SyncNASCAR(dataDir); err != nil {
		log.Printf("livesync NASCAR: %v", err)
	}
	if err := SyncOpenF1(dataDir); err != nil {
		log.Printf("livesync OpenF1: %v", err)
	}
	return nil
}

// test hooks для подмены HTTP-функций в юнит-тестах.
var (
	fetchNASCARLiveFeedFunc      = fetchNASCARLiveFeed
	fetchNASCARRacesFunc         = fetchNASCARRaces
	fetchOpenF1SessionsLatestFunc = fetchOpenF1SessionsLatest
)

// SyncNASCAR обновляет в live.json только записи NASCAR (Cup/Xfinity/Truck).
func SyncNASCAR(dataDir string) error {
	livePath := filepath.Join(dataDir, "live.json")
	live, err := fetchNASCARLiveFeedFunc()
	if err != nil || live == nil || live.RaceID == 0 {
		livesyncErrorsTotal.WithLabelValues("nascar", "live_feed").Inc()
		return mergeLiveJSONNASCAR(livePath, nil)
	}
	dataID, ok := nascarSeriesToDataID[live.SeriesID]
	if !ok {
		livesyncErrorsTotal.WithLabelValues("nascar", "unknown_series").Inc()
		return mergeLiveJSONNASCAR(livePath, nil)
	}
	season, _ := strconv.Atoi(config.CurrentSeason)
	races, err := fetchNASCARRacesFunc(live.SeriesID, season)
	if err != nil {
		livesyncErrorsTotal.WithLabelValues("nascar", "races_fetch").Inc()
		return err
	}
	raceDate := make(map[int]string)
	for _, r := range races {
		if r.RaceID != 0 && r.DateScheduled != "" {
			raceDate[r.RaceID] = dateOnly(r.DateScheduled)
		}
	}
	schedDate, ok := raceDate[live.RaceID]
	if !ok {
		livesyncErrorsTotal.WithLabelValues("nascar", "race_not_found").Inc()
		return mergeLiveJSONNASCAR(livePath, nil)
	}
	events, err := schedulefile.LoadEvents(dataDir, dataID)
	if err != nil || len(events) == 0 {
		livesyncErrorsTotal.WithLabelValues("nascar", "no_events").Inc()
		return mergeLiveJSONNASCAR(livePath, nil)
	}
	eventID := findEventByDate(events, schedDate, false)
	if eventID == "" {
		livesyncErrorsTotal.WithLabelValues("nascar", "no_matching_event").Inc()
		return mergeLiveJSONNASCAR(livePath, nil)
	}
	if err := mergeLiveJSONNASCAR(livePath, []string{eventID}); err != nil {
		livesyncErrorsTotal.WithLabelValues("nascar", "write_live_json").Inc()
		return err
	}
	livesyncLastSuccess.WithLabelValues("nascar").Set(float64(time.Now().Unix()))
	return nil
}

// SyncOpenF1 обновляет в live.json только записи F1.
func SyncOpenF1(dataDir string) error {
	livePath := filepath.Join(dataDir, "live.json")
	sessions, err := fetchOpenF1SessionsLatestFunc()
	if err != nil || len(sessions) == 0 {
		reason := "no_sessions"
		if err != nil {
			reason = "sessions_fetch"
		}
		livesyncErrorsTotal.WithLabelValues("openf1", reason).Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	session := sessions[0]
	now := time.Now().UTC()
	start, err := time.Parse(time.RFC3339, session.DateStart)
	if err != nil {
		livesyncErrorsTotal.WithLabelValues("openf1", "parse_start").Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	end, err := time.Parse(time.RFC3339, session.DateEnd)
	if err != nil {
		livesyncErrorsTotal.WithLabelValues("openf1", "parse_end").Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	if now.Before(start) || now.After(end) {
		livesyncErrorsTotal.WithLabelValues("openf1", "no_live_window").Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	events, err := schedulefile.LoadEvents(dataDir, "f1")
	if err != nil || len(events) == 0 {
		livesyncErrorsTotal.WithLabelValues("openf1", "no_events").Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	eventID := findEventByDate(events, session.DateStart, true)
	if eventID == "" {
		livesyncErrorsTotal.WithLabelValues("openf1", "no_matching_event").Inc()
		return mergeLiveJSONF1(livePath, nil)
	}
	if err := mergeLiveJSONF1(livePath, []string{eventID}); err != nil {
		livesyncErrorsTotal.WithLabelValues("openf1", "write_live_json").Inc()
		return err
	}
	livesyncLastSuccess.WithLabelValues("openf1").Set(float64(time.Now().Unix()))
	return nil
}

func sameWeekend(a, b string) bool {
	t1, err1 := time.Parse("2006-01-02", a)
	t2, err2 := time.Parse("2006-01-02", b)
	if err1 != nil || err2 != nil {
		return false
	}
	diff := t1.Sub(t2)
	if diff < 0 {
		diff = -diff
	}
	return diff <= 3*24*time.Hour
}

func dateOnly(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

// findEventByDate ищет ID события по дате начала.
// Сначала пробует точное совпадение по дате (YYYY-MM-DD),
// при allowWeekend=true — дополнительно допускает попадание в один гоночный уикенд.
func findEventByDate(events []schedulefile.EventJSON, target string, allowWeekend bool) string {
	target = strings.TrimSpace(target)
	if target == "" {
		return ""
	}
	if len(target) > 10 {
		target = target[:10]
	}
	// Сначала точное совпадение даты.
	for _, e := range events {
		d := strings.TrimSpace(e.StartDate)
		if len(d) >= 10 {
			d = d[:10]
		}
		if d == target {
			return e.ID
		}
	}
	if !allowWeekend {
		return ""
	}
	// Затем — совпадение по гоночному уикенду.
	for _, e := range events {
		d := strings.TrimSpace(e.StartDate)
		if len(d) >= 10 {
			d = d[:10]
		}
		if sameWeekend(target, d) {
			return e.ID
		}
	}
	return ""
}

func readLiveIDs(livePath string) []string {
	raw, err := os.ReadFile(livePath) //nolint:gosec
	if err != nil {
		return nil
	}
	var decoded struct {
		LiveEventIDs []string `json:"live_event_ids"`
	}
	if json.Unmarshal(raw, &decoded) == nil && len(decoded.LiveEventIDs) > 0 {
		return decoded.LiveEventIDs
	}
	var ids []string
	if json.Unmarshal(raw, &ids) == nil {
		return ids
	}
	return nil
}

func writeLiveJSON(path string, ids []string) error {
	if ids == nil {
		ids = []string{}
	}
	b, err := json.MarshalIndent(ids, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func mergeLiveJSONNASCAR(livePath string, newNascarIDs []string) error {
	current := readLiveIDs(livePath)
	if current == nil {
		current = []string{}
	}
	// Строим множество уже записанных ID (без NASCAR-серий) для дедупликации.
	filtered := current[:0]
	seen := make(map[string]struct{}, len(current))
	for _, id := range current {
		u := strings.ToUpper(id)
		if strings.HasPrefix(u, "NASCAR_CUP") || strings.HasPrefix(u, "NOAPS") || strings.HasPrefix(u, "NASCAR_TRUCK") {
			continue
		}
		filtered = append(filtered, id)
		seen[u] = struct{}{}
	}
	for _, id := range newNascarIDs {
		if id == "" {
			continue
		}
		u := strings.ToUpper(id)
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		filtered = append(filtered, id)
	}
	return writeLiveJSON(livePath, filtered)
}

func mergeLiveJSONF1(livePath string, newF1Ids []string) error {
	current := readLiveIDs(livePath)
	if current == nil {
		current = []string{}
	}
	filtered := current[:0]
	seen := make(map[string]struct{}, len(current))
	for _, id := range current {
		u := strings.ToUpper(id)
		if strings.HasPrefix(u, "F1_") {
			continue
		}
		filtered = append(filtered, id)
		seen[u] = struct{}{}
	}
	for _, id := range newF1Ids {
		if id == "" {
			continue
		}
		u := strings.ToUpper(id)
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		filtered = append(filtered, id)
	}
	return writeLiveJSON(livePath, filtered)
}

// ——— NASCAR API ———

type nascarLiveFeed struct {
	RaceID   int `json:"race_id"`
	SeriesID int `json:"series_id"`
}

type nascarRace struct {
	RaceID        int    `json:"race_id"`
	DateScheduled string `json:"date_scheduled"`
}

func fetchNASCARLiveFeed() (*nascarLiveFeed, error) {
	req, _ := http.NewRequest(http.MethodGet, nascarFeedBase+"/api/LiveFeed", nil)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: httpTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("livesync: failed to close NASCAR live feed body: %v", closeErr)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var out nascarLiveFeed
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func fetchNASCARRaces(seriesID, season int) ([]nascarRace, error) {
	url := fmt.Sprintf("%s/api/races?series_id=%d&race_season=%d", nascarFeedBase, seriesID, season)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: httpTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("livesync: failed to close NASCAR races body: %v", closeErr)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var out []nascarRace
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// ——— OpenF1 API ———

type openF1Session struct {
	DateStart string `json:"date_start"`
	DateEnd   string `json:"date_end"`
}

func fetchOpenF1SessionsLatest() ([]openF1Session, error) {
	req, _ := http.NewRequest(http.MethodGet, openF1Base+"/v1/sessions?session_key=latest", nil)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: httpTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("livesync: failed to close OpenF1 sessions body: %v", closeErr)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var out []openF1Session
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out, nil
}

// StartBackground запускает фоновый цикл синхронизации каждые interval (0 = 2 минуты).
// Останавливается при отмене ctx.
func StartBackground(ctx context.Context, dataDir string, interval time.Duration) {
	if interval <= 0 {
		interval = defaultInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	// первый запуск сразу
	if err := Run(dataDir); err != nil {
		log.Printf("livesync background tick error: %v", err)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := Run(dataDir); err != nil {
				log.Printf("livesync background tick error: %v", err)
			}
		}
	}
}
