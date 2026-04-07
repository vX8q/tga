package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
)

// dataResultsSummary — агрегированная сводка по количеству результатов JSON vs БД.
type dataResultsSummary struct {
	Series     string `json:"series"`
	Season     string `json:"season"`
	JSONEvents int    `json:"json_events"`
	DBEvents   int    `json:"db_events"`
	JSONResults int   `json:"json_results"`
	DBResults   int   `json:"db_results"`
}

// resultDiff — конкретное расхождение по event/race/driver.
type resultDiff struct {
	Series   string `json:"series"`
	Season   string `json:"season"`
	EventID  string `json:"event_id"`
	RaceID   string `json:"race_id"`
	DriverID string `json:"driver_id"`
	Kind     string `json:"kind"` // "missing_in_db" или "extra_in_db"
}

type dataDiffResponse struct {
	Season  string               `json:"season"`
	Summary []dataResultsSummary `json:"summary"`
	Diffs   []resultDiff         `json:"diffs"`
}

// handleDataDiff строит отчёт по расхождениям между JSON и БД для результатов гонок.
// Делает детальный diff только для сток-кар серий (StockCarRacing), которые импортируются в БД.
func handleDataDiff(w http.ResponseWriter, r *http.Request, dataDir string, st store.Store) {
	w.Header().Set("Content-Type", "application/json")

	season := config.CurrentSeason
	resp := dataDiffResponse{Season: season}

	if st == nil {
		_ = json.NewEncoder(w).Encode(resp)
		return
	}
	if _, isNoop := st.(store.NoopStore); isNoop {
		_ = json.NewEncoder(w).Encode(resp)
		return
	}

	ctx := r.Context()
	var summaries []dataResultsSummary
	var diffs []resultDiff

	for _, c := range config.Championships {
		if c.Type != config.StockCarRacing {
			continue
		}
		dataID := config.DataSeriesID(c.ID)

		events, err := schedulefile.LoadEvents(dataDir, dataID)
		if err != nil || len(events) == 0 {
			continue
		}

		jsonEvents := 0
		dbEvents := 0
		jsonResults := 0
		dbResultsTotal := 0

		// Подсчёт по JSON.
		for _, e := range events {
			if e.Season != season {
				continue
			}
			jsonEvents++

			detail, err := schedulefile.LoadEventDetail(dataDir, e.ID)
			if err != nil || detail == nil || detail.Tables == nil {
				continue
			}
			rr, ok := detail.Tables["race_results"]
			if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
				continue
			}
			colDriver := firstHeaderIndex(rr.Headers, "Driver")
			if colDriver < 0 {
				continue
			}
			for _, row := range rr.Rows {
				if colDriver >= len(row) {
					continue
				}
				if strings.TrimSpace(row[colDriver]) == "" {
					continue
				}
				jsonResults++
			}
		}

		// Подсчёт по БД (events + results).
		if dbEventsList, err := st.ListEvents(ctx, c.ID, season); err == nil {
			dbEvents = len(dbEventsList)
			for _, ev := range dbEventsList {
				raceID := ev.ID + ":RACE"
				if res, err := st.ListResultsByRace(ctx, raceID); err == nil {
					dbResultsTotal += len(res)
				}
			}
		}

		summaries = append(summaries, dataResultsSummary{
			Series:      c.ID,
			Season:      season,
			JSONEvents:  jsonEvents,
			DBEvents:    dbEvents,
			JSONResults: jsonResults,
			DBResults:   dbResultsTotal,
		})

		// Детальный diff только если есть расхождения по количеству results.
		if jsonResults == 0 || jsonResults == dbResultsTotal {
			continue
		}

		for _, e := range events {
			if e.Season != season {
				continue
			}
			raceID := e.ID + ":RACE"

			detail, err := schedulefile.LoadEventDetail(dataDir, e.ID)
			if err != nil || detail == nil || detail.Tables == nil {
				continue
			}
			rr, ok := detail.Tables["race_results"]
			if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
				continue
			}

			colDriver := firstHeaderIndex(rr.Headers, "Driver")
			colNo := firstHeaderIndex(rr.Headers, "No", "#", "Car")
			if colDriver < 0 {
				continue
			}

			expected := make(map[string]struct{})
			for _, row := range rr.Rows {
				if colDriver >= len(row) {
					continue
				}
				driverName := strings.TrimSpace(row[colDriver])
				if driverName == "" {
					continue
				}
				carNumber := valueOrEmpty(row, colNo)
				carForDriverID := carNumber
				if strings.EqualFold(c.ID, "SUPERCARS") {
					carForDriverID = schedulefile.SupercarsCarToCanonical(carNumber)
				}
				driverID := driverutil.MakeDriverID(c.ID, driverName, carForDriverID)
				if driverID == "" {
					continue
				}
				expected[driverID] = struct{}{}
			}

			dbRes, err := st.ListResultsByRace(ctx, raceID)
			if err != nil {
				slog.Warn("data diff: list results failed", "series", c.ID, "race_id", raceID, "err", err)
				continue
			}
			actual := make(map[string]struct{}, len(dbRes))
			for _, rRes := range dbRes {
				if rRes.DriverID == "" {
					continue
				}
				actual[rRes.DriverID] = struct{}{}
			}

			for driverID := range expected {
				if _, ok := actual[driverID]; !ok {
					diffs = append(diffs, resultDiff{
						Series:   c.ID,
						Season:   season,
						EventID:  e.ID,
						RaceID:   raceID,
						DriverID: driverID,
						Kind:     "missing_in_db",
					})
				}
			}
			for driverID := range actual {
				if _, ok := expected[driverID]; !ok {
					diffs = append(diffs, resultDiff{
						Series:   c.ID,
						Season:   season,
						EventID:  e.ID,
						RaceID:   raceID,
						DriverID: driverID,
						Kind:     "extra_in_db",
					})
				}
			}
		}
	}

	resp.Summary = summaries
	resp.Diffs = diffs
	_ = json.NewEncoder(w).Encode(resp)
}
