package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/models"
)

func handleSeriesList(w http.ResponseWriter, r *http.Request, st store.Store) {
	w.Header().Set("Content-Type", "application/json")

	season := config.CurrentSeason

	if st != nil {
		ctx := r.Context()
		series, err := st.ListSeries(ctx, season)
		if err != nil {
			slog.Error("list series failed",
				"season", season,
				"err", err,
				"trace_id", TraceID(ctx),
			)
			writeError(w, http.StatusInternalServerError, "failed to list series")
			return
		}
		if len(series) > 0 {
			// В БД могут отсутствовать строки для новых серий (старая БД до bootstrap) — дополняем из config.
			seen := make(map[string]bool, len(series))
			for _, s := range series {
				seen[s.ID] = true
			}
			for _, c := range config.Championships {
				if !seen[c.ID] {
					series = append(series, models.Series{
						ID: c.ID, Name: c.Name, Season: c.Season,
						Type: string(c.Type), Country: c.Country,
					})
				}
			}
			list := make([]map[string]string, len(series))
			for i, s := range series {
				list[i] = map[string]string{
					"id": s.ID, "name": s.Name, "season": s.Season,
					"type": s.Type, "country": s.Country,
				}
			}
			_ = json.NewEncoder(w).Encode(list)
			return
		}
	}

	list := make([]map[string]string, len(config.Championships))
	for i, c := range config.Championships {
		list[i] = map[string]string{
			"id": c.ID, "name": c.Name, "season": c.Season,
			"type": string(c.Type), "country": c.Country,
		}
	}
	_ = json.NewEncoder(w).Encode(list)
}

func handleSeries(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	suffix := strings.TrimPrefix(r.URL.Path, "/api/series/")
	if suffix == "" {
		http.Redirect(w, r, "/api/series", http.StatusMovedPermanently)
		return
	}
	parts := strings.SplitN(suffix, "/", 2)
	seriesID := parts[0]
	subPath := ""
	if len(parts) == 2 {
		subPath = parts[1]
	}
	if !ValidEventOrSeriesID(seriesID) {
		writeError(w, http.StatusBadRequest, "invalid series id")
		return
	}
	dataSeriesID := config.DataSeriesID(seriesID)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")

	seasonStr := strings.TrimSpace(r.URL.Query().Get("season"))
	if seasonStr == "" {
		// Извлекаем сезон из slug (f1-2025 -> 2025)
		if idx := strings.LastIndex(seriesID, "-"); idx > 0 && idx+5 == len(seriesID) {
			if y := seriesID[idx+1:]; len(y) == 4 {
				if _, err := strconv.Atoi(y); err == nil {
					seasonStr = y
				}
			}
		}
		if seasonStr == "" {
			seasonStr = config.CurrentSeason
		}
	} else if _, err := strconv.Atoi(seasonStr); err != nil {
		writeError(w, http.StatusBadRequest, "invalid season")
		return
	}

	switch subPath {
	case "events":
		handleSeriesEvents(w, r, dataDir, dataSeriesID, st, seasonStr)
	case "teams":
		handleSeriesTeams(w, r, dataDir, dataSeriesID, seasonStr)
	case "standings":
		handleSeriesStandings(w, r, dataDir, dataSeriesID, seasonStr)
	case "stats":
		handleSeriesStats(w, r, dataDir, dataSeriesID, seasonStr)
	case "headtohead":
		handleSeriesHeadToHead(w, r, dataDir, dataSeriesID, seasonStr)
	case "history":
		if strings.EqualFold(seriesID, "f1") {
			handleSeriesF1History(w, r, dataDir)
		} else {
			writeError(w, http.StatusNotFound, "not found")
		}
	default:
		handleSeriesMeta(w, r, seriesID, dataSeriesID, st, seasonStr)
	}
}

func handleSeriesEvents(w http.ResponseWriter, r *http.Request, dataDir, dataSeriesID string, st store.Store, season string) {
	type EventWithDetail struct {
		schedulefile.EventJSON
		HasDetail bool `json:"has_detail"`
	}

	// 1) Сначала читаем из JSON — это источник истины для расписания (редактируемые data/schedules/*.json).
	events, err := schedulefile.LoadEvents(dataDir, dataSeriesID)
	if err == nil && len(events) > 0 {
		// Фильтруем по сезону, если в файле несколько сезонов
		filtered := events
		if season != "" {
			var match []schedulefile.EventJSON
			for _, e := range events {
				if e.Season == season {
					match = append(match, e)
				}
			}
			if len(match) > 0 {
				filtered = match
			}
		}
		enriched := make([]EventWithDetail, len(filtered))
		for i, e := range filtered {
			eventIDLower := strings.ToLower(e.ID)
			hasDetail := schedulefile.EventDetailExists(dataDir, eventIDLower)
			if !hasDetail && isEventSoon(e.StartDate) {
				hasDetail = true
			}
			enriched[i] = EventWithDetail{EventJSON: e, HasDetail: hasDetail}
		}
		_ = json.NewEncoder(w).Encode(enriched)
		return
	}

	// 2) Фоллбек: если JSON пустой или файла нет — берём из БД.
	if st != nil {
		ctx := r.Context()
		dbSeriesID := strings.ToUpper(dataSeriesID)
		dbEvents, err := st.ListEvents(ctx, dbSeriesID, season)
		if err != nil {
			slog.Error("list events failed",
				"series", dbSeriesID,
				"season", season,
				"err", err,
				"trace_id", TraceID(ctx),
			)
			writeError(w, http.StatusInternalServerError, "failed to list events")
			return
		}
		if len(dbEvents) > 0 {
			enriched := make([]EventWithDetail, len(dbEvents))
			for i, e := range dbEvents {
				ev := schedulefile.EventJSON{
					ID:          e.ID,
					SeriesID:    e.SeriesID,
					Season:      e.Season,
					Name:        e.Name,
					Location:    e.Location,
					CircuitName: e.CircuitName,
					StartDate:   e.StartDate.Format("2006-01-02"),
					EndDate:     e.EndDate.Format("2006-01-02"),
					TimeEST:     e.TimeEST,
					TimeMSK:     e.TimeMSK,
				}
				eventIDLower := strings.ToLower(ev.ID)
				hasDetail := schedulefile.EventDetailExists(dataDir, eventIDLower)
				if !hasDetail && isEventSoon(ev.StartDate) {
					hasDetail = true
				}
				enriched[i] = EventWithDetail{EventJSON: ev, HasDetail: hasDetail}
			}
			_ = json.NewEncoder(w).Encode(enriched)
			return
		}
	}

	if events == nil {
		events = []schedulefile.EventJSON{}
	}
	enriched := make([]EventWithDetail, len(events))
	for i, e := range events {
		eventIDLower := strings.ToLower(e.ID)
		hasDetail := schedulefile.EventDetailExists(dataDir, eventIDLower)
		if !hasDetail && isEventSoon(e.StartDate) {
			hasDetail = true
		}
		enriched[i] = EventWithDetail{EventJSON: e, HasDetail: hasDetail}
	}
	_ = json.NewEncoder(w).Encode(enriched)
}

// isEventSoon возвращает true, если дата старта события в формате YYYY-MM-DD
// находится в диапазоне [сегодня; сегодня+7 дней] (в местном времени).
func isEventSoon(startDate string) bool {
	const layout = "2006-01-02"
	startDate = strings.TrimSpace(startDate)
	if startDate == "" {
		return false
	}
	d, err := time.Parse(layout, startDate)
	if err != nil {
		return false
	}
	today := time.Now().Truncate(24 * time.Hour)
	d = d.Truncate(24 * time.Hour)
	if d.Before(today) {
		return false
	}
	if d.After(today.AddDate(0, 0, 7)) {
		return false
	}
	return true
}

func handleSeriesTeams(w http.ResponseWriter, _ *http.Request, dataDir, dataSeriesID, season string) {
	data, err := schedulefile.LoadTeamsForSeason(dataDir, dataSeriesID, season)
	if err != nil {
		slog.Error("load teams failed",
			"series", dataSeriesID,
			"err", err,
		)
		writeError(w, http.StatusInternalServerError, "failed to load teams")
		return
	}
	if data == nil {
		data = &schedulefile.TeamsWithSpec{}
	}
	if strings.EqualFold(dataSeriesID, "imsa") && len(data.Teams) == 0 {
		teamsPath := filepath.Join(dataDir, "teams", strings.ToLower(dataSeriesID)+".json")
		slog.Info("IMSA teams empty", "path", teamsPath, "data_dir", dataDir)
	}
	_ = json.NewEncoder(w).Encode(data)
}

func handleSeriesStandings(w http.ResponseWriter, _ *http.Request, dataDir, dataSeriesID string, season string) {
	var (
		data *schedulefile.StandingsData
		err  error
	)
	if season == "" {
		season = config.CurrentSeason
	}

	// IMSA: standings могут быть полностью заданы в JSON (в том числе по классам),
	// поэтому не пытаемся собирать их из event-results, а читаем файл как есть.
	if strings.EqualFold(dataSeriesID, "IMSA") {
		data, err = schedulefile.LoadStandings(dataDir, dataSeriesID)
		if err != nil {
			slog.Error("load standings failed",
				"series", dataSeriesID,
				"err", err,
			)
			writeError(w, http.StatusInternalServerError, "failed to load standings")
			return
		}
	} else if strings.EqualFold(dataSeriesID, "GTWCE_END") || strings.EqualFold(dataSeriesID, "GTWCE_SPRINT") {
		sidUp := "GTWCE_END"
		if strings.EqualFold(dataSeriesID, "GTWCE_SPRINT") {
			sidUp = "GTWCE_SPRINT"
		}
		data, err = schedulefile.BuildGtwceStandingsFromEvents(dataDir, sidUp, season)
		if err != nil {
			slog.Error("gtwce standings failed",
				"series", dataSeriesID,
				"err", err,
			)
			writeError(w, http.StatusInternalServerError, "failed to build standings")
			return
		}
	} else if strings.EqualFold(dataSeriesID, "SUPERCARS") {
		data, err = loadSupercarsStandings(dataDir, season)
		if err != nil {
			slog.Error("supercars standings failed",
				"series", dataSeriesID,
				"err", err,
			)
			writeError(w, http.StatusInternalServerError, "failed to load standings")
			return
		}
	} else {
		data, err = schedulefile.BuildStandingsFromEvents(dataDir, dataSeriesID, season)
		if err != nil {
			slog.Error("build standings failed",
				"series", dataSeriesID,
				"err", err,
			)
			writeError(w, http.StatusInternalServerError, "failed to build standings")
			return
		}
		if data == nil {
			data, err = schedulefile.LoadStandings(dataDir, dataSeriesID)
			if err != nil {
				slog.Error("load standings failed",
					"series", dataSeriesID,
					"err", err,
				)
				writeError(w, http.StatusInternalServerError, "failed to load standings")
				return
			}
			if data != nil {
				schedulefile.SplitBaseIneligible(data)
			}
		}
	}
	if data == nil {
		data = &schedulefile.StandingsData{Rows: []schedulefile.StandingRow{}}
	}
	schedulefile.EnsureCompletedRaces(dataDir, dataSeriesID, data)
	if len(data.Rows) > 0 && dataSeriesID != "ARCA" {
		schedulefile.EnrichStagesFromEvents(dataDir, dataSeriesID, data)
	}
	if strings.EqualFold(dataSeriesID, "SUPERCARS") && len(data.Rows) > 0 {
		finalizeSupercarsStandings(dataDir, data)
	}
	_ = json.NewEncoder(w).Encode(data)
}

// loadSupercarsStandings собирает таблицу для Supercars в порядке приоритета:
//  1. data/standings/supercars.json — основной источник (ведётся вручную, содержит все завершённые гонки);
//  2. BuildStandingsFromEvents — если файла нет или он пустой;
//  3. BuildSupercarsStandingsFromFiles — устаревший сборщик из Sydney/Melbourne (нужен только как аварийный fallback).
func loadSupercarsStandings(dataDir, season string) (*schedulefile.StandingsData, error) {
	if fileData, err := schedulefile.LoadStandings(dataDir, "SUPERCARS"); err != nil {
		return nil, err
	} else if fileData != nil && len(fileData.Rows) > 0 {
		schedulefile.SplitBaseIneligible(fileData)
		return fileData, nil
	}
	if built, err := schedulefile.BuildStandingsFromEvents(dataDir, "SUPERCARS", season); err != nil {
		return nil, err
	} else if built != nil && len(built.Rows) > 0 {
		return built, nil
	}
	if built, err := schedulefile.BuildSupercarsStandingsFromFiles(dataDir); err == nil && built != nil && len(built.Rows) > 0 {
		return built, nil
	}
	return nil, nil
}

// finalizeSupercarsStandings применяет Supercars-специфичные пост-обработки:
// нормализация <7 колонок (аварийный путь), слияние дубликатов (car 800 ↔ 8)
// и пересчёт completed_races по фактически заполненным колонкам.
func finalizeSupercarsStandings(dataDir string, data *schedulefile.StandingsData) {
	if len(data.RaceOrder) < 7 {
		was := len(data.RaceOrder)
		schedulefile.NormalizeSupercarsStandingsToSeven(data)
		schedulefile.EnrichSupercarsStandingsWithMelbourne(dataDir, data)
		slog.Info("supercars standings normalized to baseline columns",
			"was", was,
			"now", len(data.RaceOrder),
		)
	}
	schedulefile.MergeSupercarsCar800Into8(data)
	schedulefile.RecomputeCompletedRacesFromFilled(data)
}

func handleSeriesStats(w http.ResponseWriter, r *http.Request, dataDir, dataSeriesID, season string) {
	var (
		data *schedulefile.DriverStatsData
		err  error
	)

	// Абсолютно вся статистика вычисляется из JSON (data/events/*.json),
	// чтобы исключить расхождения между результатами, захардкоженными в SQLite, и исходными файлами.
	data, err = schedulefile.BuildDriverStatsFromEvents(dataDir, dataSeriesID, season)
	if err != nil {
		slog.Error("build stats from events failed",
			"series", dataSeriesID,
			"season", season,
			"err", err,
			"trace_id", TraceID(r.Context()),
		)
		writeError(w, http.StatusInternalServerError, "failed to build stats")
		return
	}
	if data == nil {
		data = &schedulefile.DriverStatsData{Rows: []schedulefile.DriverStatsRow{}}
	}
	_ = json.NewEncoder(w).Encode(data)
}

func handleSeriesHeadToHead(w http.ResponseWriter, r *http.Request, dataDir, dataSeriesID, season string) {
	driverA := strings.TrimSpace(r.URL.Query().Get("driverA"))
	driverB := strings.TrimSpace(r.URL.Query().Get("driverB"))
	if driverA == "" || driverB == "" {
		_ = json.NewEncoder(w).Encode(&schedulefile.HeadToHeadData{Events: []schedulefile.HeadToHeadEvent{}})
		return
	}

	data, err := schedulefile.BuildHeadToHeadFromEvents(dataDir, dataSeriesID, season, driverA, driverB)
	if err != nil {
		slog.Error("build head-to-head failed",
			"series", dataSeriesID,
			"season", season,
			"driverA", driverA,
			"driverB", driverB,
			"err", err,
		)
		writeError(w, http.StatusInternalServerError, "failed to build head-to-head")
		return
	}
	if data == nil {
		data = &schedulefile.HeadToHeadData{Events: []schedulefile.HeadToHeadEvent{}}
	}
	_ = json.NewEncoder(w).Encode(data)
}

func handleSeriesF1History(w http.ResponseWriter, _ *http.Request, dataDir string) {
	path := filepath.Join(dataDir, "f1_seasons_history.json")
	data, err := os.ReadFile(path) //nolint:gosec
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "history data not found")
			return
		}
		slog.Error("read f1 history failed", "path", path, "err", err)
		writeError(w, http.StatusInternalServerError, "failed to load history")
		return
	}
	if !json.Valid(data) {
		slog.Error("parse f1 history failed: invalid JSON")
		writeError(w, http.StatusInternalServerError, "invalid history data")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
}

func handleSeriesMeta(w http.ResponseWriter, r *http.Request, seriesID, dataSeriesID string, st store.Store, season string) {
	var out map[string]string

	if st != nil {
		ctx := r.Context()
		series, err := st.ListSeries(ctx, season)
		if err != nil {
			slog.Error("list series failed",
				"season", season,
				"err", err,
				"trace_id", TraceID(ctx),
			)
			writeError(w, http.StatusInternalServerError, "failed to list series")
			return
		}
		for _, s := range series {
			if strings.EqualFold(s.ID, seriesID) {
				out = map[string]string{
					"id": s.ID, "name": s.Name, "season": s.Season,
					"type": s.Type, "country": s.Country,
				}
				break
			}
		}
	}

	if out == nil {
		for _, c := range config.Championships {
			// Поддержка сезонных slug'ов вида f1-2025:
			// сравниваем как с исходным seriesID из URL, так и с dataSeriesID (F1).
			if strings.EqualFold(c.ID, seriesID) || strings.EqualFold(c.ID, dataSeriesID) {
				out = map[string]string{
					"id": c.ID, "name": c.Name, "season": c.Season,
					"type": string(c.Type), "country": c.Country,
				}
				break
			}
		}
		// Ссылки и данные используют noaps; если в конфиге серия как NASCAR_XFINITY — отдаём её по запросу noaps.
		if out == nil && dataSeriesID == "noaps" {
			for _, c := range config.Championships {
				if c.ID == "NOAPS" {
					out = map[string]string{
						"id": "NOAPS", "name": c.Name, "season": c.Season,
						"type": string(c.Type), "country": c.Country,
					}
					break
				}
			}
		}
	}

	if out == nil {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

