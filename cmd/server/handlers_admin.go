package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
)

type seriesHealth struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Season     string   `json:"season"`
	OK         bool     `json:"ok"`
	Missing    []string `json:"missing"`
	Events     int      `json:"events"`
	DBEvents   int      `json:"db_events"`
	DataID     string   `json:"data_id"`
	Type       string   `json:"type"`
	Country    string   `json:"country"`
	HasDB      bool     `json:"has_db"`
	DBDegraded bool     `json:"db_degraded"`
}

type dataHealthResponse struct {
	OK     bool           `json:"ok"`
	Season string         `json:"season"`
	Series []seriesHealth `json:"series"`
	Live   liveSummary    `json:"live"`
}

type liveSummary struct {
	Events int      `json:"events"`
	Series int      `json:"series"`
	IDs    []string `json:"ids"`
}

func handleDataHealth(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	w.Header().Set("Content-Type", "application/json")

	season := config.CurrentSeason
	byID := make(map[string]config.Championship)
	for _, c := range config.Championships {
		byID[strings.ToUpper(c.ID)] = c
	}

	var out dataHealthResponse
	out.OK = true
	out.Season = season

	for _, c := range config.Championships {
		dataID := config.DataSeriesID(c.ID)

		h := seriesHealth{
			ID:      c.ID,
			Name:    c.Name,
			Season:  c.Season,
			DataID:  dataID,
			Type:    string(c.Type),
			Country: c.Country,
		}

		// schedules
		schedPath := filepath.Join(dataDir, "schedules", strings.ToLower(dataID)+".json")
		if _, err := os.Stat(schedPath); err != nil {
			if os.IsNotExist(err) {
				h.Missing = append(h.Missing, "schedules")
			} else {
				h.Missing = append(h.Missing, "schedules_error")
				slog.Warn("data health: schedules stat failed", "series", c.ID, "path", schedPath, "err", err)
			}
		}

		// teams
		if _, err := schedulefile.LoadTeams(dataDir, dataID); err != nil {
			h.Missing = append(h.Missing, "teams")
		}

		// standings (не считаем ошибку критичной, если ещё не собраны)
		if _, err := schedulefile.LoadStandings(dataDir, dataID); err != nil && !os.IsNotExist(err) {
			h.Missing = append(h.Missing, "standings_error")
		}

		// events (JSON): считаем по расписанию; наличие хотя бы одного файла events/<id>.json для текущего сезона.
		events, err := schedulefile.LoadEvents(dataDir, dataID)
		if err == nil && len(events) > 0 {
			eventCount := 0
			for _, e := range events {
				if e.Season != season {
					continue
				}
				eventCount++
				evPath := filepath.Join(dataDir, "events", strings.ToLower(e.ID)+".json")
				if _, err := os.Stat(evPath); err != nil {
					if os.IsNotExist(err) {
						h.Missing = append(h.Missing, "events:"+e.ID)
					} else {
						slog.Warn("data health: events stat failed", "event_id", e.ID, "path", evPath, "err", err)
					}
				}
			}
			h.Events = eventCount
		} else if err != nil {
			h.Missing = append(h.Missing, "events_schedule")
			slog.Warn("data health: load events failed", "series", c.ID, "err", err)
		}

		// DB presence / health (если не Noop) + простая сверка количества событий между JSON и БД.
		if st != nil {
			if _, isNoop := st.(store.NoopStore); !isNoop {
				h.HasDB = true
				if err := st.Health(r.Context()); err != nil {
					h.DBDegraded = true
					slog.Warn("data health: store health failed", "err", err, "trace_id", TraceID(r.Context()))
				} else {
					if dbEvents, err := st.ListEvents(r.Context(), c.ID, season); err == nil {
						h.DBEvents = len(dbEvents)
						if h.Events > 0 && h.DBEvents != h.Events {
							h.Missing = append(h.Missing, "db_events_mismatch")
						}
					}
				}
			}
		}

		h.OK = len(h.Missing) == 0 && !h.DBDegraded
		if !h.OK {
			out.OK = false
		}
		out.Series = append(out.Series, h)
	}

	

	// Live dashboard: простая сводка по live.json (кол-во событий и серий).
	livePath := filepath.Join(dataDir, "live.json")
	liveIDs := readLiveIDsCompat(livePath)
	if len(liveIDs) > 0 {
		out.Live.IDs = liveIDs
		out.Live.Events = len(liveIDs)
		seriesSet := make(map[string]struct{})
		for _, id := range liveIDs {
			u := strings.ToUpper(id)
			for _, c := range config.Championships {
				if strings.HasPrefix(u, strings.ToUpper(c.ID)+"_") {
					seriesSet[c.ID] = struct{}{}
					break
				}
			}
		}
		out.Live.Series = len(seriesSet)
	}

	_ = json.NewEncoder(w).Encode(out)
}

// readLiveIDsCompat читает live.json в формате []string или {"live_event_ids":[]} (для обратной совместимости).
func readLiveIDsCompat(path string) []string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var obj struct {
		LiveEventIDs []string `json:"live_event_ids"`
	}
	if json.Unmarshal(raw, &obj) == nil && len(obj.LiveEventIDs) > 0 {
		return obj.LiveEventIDs
	}
	var arr []string
	if json.Unmarshal(raw, &arr) == nil {
		return arr
	}
	return nil
}

