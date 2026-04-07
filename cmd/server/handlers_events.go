package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/cache"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
)

func handleEvent(w http.ResponseWriter, r *http.Request, dataDir string, _ *cache.TTL) {
	eventID := strings.TrimPrefix(r.URL.Path, "/api/events/")
	eventID = strings.TrimRight(eventID, "/")
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		http.NotFound(w, r)
		return
	}
	if !ValidEventOrSeriesID(eventID) {
		writeError(w, http.StatusBadRequest, "invalid event id")
		return
	}
	cacheKey := strings.ToLower(eventID)
	// Не кэшируем ответ события, чтобы правки в JSON (laps, distance, tables) сразу отображались.
	// Чтение через schedulefile учитывает data/events/{Серия}/{Год} и плоский каталог.
	body, err := schedulefile.ReadEventDetailFile(dataDir, cacheKey)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		slog.Error("load event failed",
			"event_id", eventID,
			"err", err,
			"trace_id", TraceID(r.Context()),
		)
		writeError(w, http.StatusInternalServerError, "failed to load event")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")

	seriesID := extractSeriesIDFromEventID(eventID)
	if enriched, err := schedulefile.EnrichSupercarsEvent(body, dataDir, seriesID); err == nil {
		body = enriched
	}
	if enriched, err := schedulefile.EnrichStockCarEventTeamNames(body, dataDir, seriesID); err == nil {
		body = enriched
	}
	_, _ = w.Write(body)
}

// handleLiveEvents возвращает список event_id, которые сейчас в статусе "live".
// Источник: data/live.json. События, по которым уже есть результаты в БД, исключаются — гонка не показывается как LIVE.
func handleLiveEvents(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	livePath := filepath.Join(dataDir, "live.json")
	body, err := os.ReadFile(livePath)
	var ids []string
	if err == nil {
		var decoded struct {
			LiveEventIDs []string `json:"live_event_ids"`
		}
		if err := json.Unmarshal(body, &decoded); err == nil && len(decoded.LiveEventIDs) > 0 {
			ids = decoded.LiveEventIDs
		} else {
			if err := json.Unmarshal(body, &ids); err != nil {
				slog.Warn("unmarshal live.json failed", "path", livePath, "err", err)
			}
		}
	} else if !os.IsNotExist(err) {
		slog.Warn("read live.json failed", "path", livePath, "err", err)
	}
	if ids == nil {
		ids = []string{}
	}
	if st != nil && len(ids) > 0 {
		ctx := r.Context()
		filtered := make([]string, 0, len(ids))
		for _, id := range ids {
			if id == "" {
				continue
			}
			eventID := strings.ToUpper(strings.TrimSpace(id))
			races, err := st.ListRacesByEvent(ctx, eventID)
			if err != nil || len(races) == 0 {
				filtered = append(filtered, eventID)
				continue
			}
			hasResults := false
			for _, ra := range races {
				results, err := st.ListResultsByRace(ctx, ra.ID)
				if err == nil && len(results) > 0 {
					hasResults = true
					break
				}
			}
			if !hasResults {
				filtered = append(filtered, eventID)
			}
		}
		ids = filtered
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, max-age=60")
	_ = json.NewEncoder(w).Encode(ids)
}

// extractSeriesIDFromEventID extracts the series part from an event ID
// like "NASCAR_CUP_2026_1" -> "nascar_cup" by matching against known series.
func extractSeriesIDFromEventID(eventID string) string {
	upper := strings.ToUpper(eventID)
	for _, c := range config.Championships {
		prefix := strings.ToUpper(c.ID) + "_"
		if strings.HasPrefix(upper, prefix) {
			return strings.ToLower(c.ID)
		}
	}
	return strings.ToLower(strings.Split(eventID, "_")[0])
}

