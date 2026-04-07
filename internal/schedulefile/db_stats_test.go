package schedulefile

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

// TestBuildDriverStatsFromDB_ConsistentWithJSON проверяет, что агрегированная статистика из БД
// совпадает с результатом JSON-пути для одной и той же серии/сезона.
func TestBuildDriverStatsFromDB_ConsistentWithJSON(t *testing.T) {
	dataDir := t.TempDir()
	seriesID := "STATS_SERIES_DB"
	season := "2026"

	events := []EventJSON{
		{
			ID:        "STATS_SERIES_DB_2026_1",
			SeriesID:  seriesID,
			Season:    season,
			Name:      "Stats Race DB",
			StartDate: "2026-01-01",
			EndDate:   "2026-01-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "stats_series_db.json"), events)

	detail := &EventDetailJSON{
		EventID: "STATS_SERIES_DB_2026_1",
		Laps:    "100",
		Tables: map[string]EventTable{
			"race_results": {
				Headers: []string{"Pos", "Driver", "Team", "Manufacturer", "Grid", "Laps", "Led", "Car"},
				Rows: [][]string{
					{"1", "Driver A", "Team A", "Ford", "1", "100", "50", "12"},
					{"2", "Driver B", "Team B", "Toyota", "2", "100", "0", "34"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "stats_series_db_2026_1.json"), detail)

	jsonStats, err := buildDriverStatsFromJSON(dataDir, seriesID, season)
	if err != nil {
		t.Fatalf("buildDriverStatsFromJSON error: %v", err)
	}
	if jsonStats == nil || len(jsonStats.Rows) == 0 {
		t.Fatalf("jsonStats is nil or empty: %+v", jsonStats)
	}

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	defer db.Close()

	schema := `
CREATE TABLE driver_stats_stockcar (
  driver_name TEXT,
  team_name TEXT,
  manufacturer TEXT,
  car_number TEXT,
  races INTEGER,
  wins INTEGER,
  poles INTEGER,
  top5 INTEGER,
  top10 INTEGER,
  top15 INTEGER,
  top20 INTEGER,
  avg_finish REAL,
  avg_start REAL,
  stage_wins INTEGER,
  stage_points INTEGER,
  avg_stage_points REAL,
  laps_led INTEGER,
  laps_completed_pct REAL,
  pos_diff REAL,
  series_id TEXT,
  season TEXT
);`
	if _, err := db.Exec(schema); err != nil {
		t.Fatalf("create table driver_stats_stockcar: %v", err)
	}

	insertSQL := `
INSERT INTO driver_stats_stockcar (
  driver_name, team_name, manufacturer, car_number,
  races, wins, poles, top5, top10, top15, top20,
  avg_finish, avg_start,
  stage_wins, stage_points, avg_stage_points,
  laps_led, laps_completed_pct, pos_diff,
  series_id, season
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
	ins, err := db.Prepare(insertSQL)
	if err != nil {
		t.Fatalf("prepare insert: %v", err)
	}
	defer ins.Close()

	for _, r := range jsonStats.Rows {
		if _, err := ins.Exec(
			r.Driver,
			r.Team,
			r.Manufacturer,
			r.Car,
			r.Races,
			r.Wins,
			r.Poles,
			r.Top5,
			r.Top10,
			r.Top15,
			r.Top20,
			r.AvgFinish,
			r.AvgStart,
			r.StageWins,
			r.StagePoints,
			r.AvgStagePoints,
			r.LapsLed,
			r.LapsCompletedPct,
			r.PositionDiff,
			seriesID,
			season,
		); err != nil {
			t.Fatalf("insert row for driver %q: %v", r.Driver, err)
		}
	}

	dbStats, err := BuildDriverStatsFromDB(db, dataDir, seriesID, season)
	if err != nil {
		t.Fatalf("BuildDriverStatsFromDB error: %v", err)
	}
	if dbStats == nil {
		t.Fatal("dbStats is nil")
	}
	if len(dbStats.Rows) != len(jsonStats.Rows) {
		t.Fatalf("len(dbStats.Rows) = %d, want %d", len(dbStats.Rows), len(jsonStats.Rows))
	}

	for i := range jsonStats.Rows {
		jr := jsonStats.Rows[i]
		dr := dbStats.Rows[i]

		if jr.Driver != dr.Driver || jr.Team != dr.Team || jr.Manufacturer != dr.Manufacturer || jr.Car != dr.Car {
			t.Errorf("row %d identity mismatch:\n  JSON: %+v\n  DB:   %+v", i, jr, dr)
		}
		if jr.Races != dr.Races || jr.Wins != dr.Wins || jr.Poles != dr.Poles {
			t.Errorf("row %d counts mismatch (driver %q): JSON=%+v DB=%+v", i, jr.Driver, jr, dr)
		}
		if jr.AvgFinish != dr.AvgFinish || jr.AvgStart != dr.AvgStart {
			t.Errorf("row %d averages mismatch (driver %q): AvgFinish JSON=%v DB=%v, AvgStart JSON=%v DB=%v",
				i, jr.Driver, jr.AvgFinish, dr.AvgFinish, jr.AvgStart, dr.AvgStart)
		}
		if jr.LapsCompletedPct != dr.LapsCompletedPct {
			t.Errorf("row %d laps pct mismatch (driver %q): JSON=%v DB=%v",
				i, jr.Driver, jr.LapsCompletedPct, dr.LapsCompletedPct)
		}
		if jr.PositionDiff != dr.PositionDiff {
			t.Errorf("row %d pos diff mismatch (driver %q): JSON=%v DB=%v",
				i, jr.Driver, jr.PositionDiff, dr.PositionDiff)
		}
	}
}

