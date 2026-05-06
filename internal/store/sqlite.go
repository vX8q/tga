// Package store provides database-backed storage implementations.
package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	_ "modernc.org/sqlite" // register sqlite driver

	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/models"
)

// SQLiteStore реализует Store поверх SQLite (modernc.org/sqlite).
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore открывает (или создаёт) файл БД и применяет минимальную схему.
func NewSQLiteStore(path string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// SQLite: один writer — ограничиваем пул для стабильной записи
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	for _, pragma := range []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA journal_mode=WAL`,
		`PRAGMA synchronous=NORMAL`,
		`PRAGMA cache_size=-64000`, // 64MB
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	if err := initSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &SQLiteStore{db: db}, nil
}

// DB возвращает внутренний *sql.DB для случаев, когда нужен прямой доступ к вью/сырым запросам.
// Использовать осторожно, предпочитая методы Store там, где это возможно.
func (s *SQLiteStore) DB() *sql.DB {
	return s.db
}

// Close закрывает соединение с БД. Вызывать при завершении работы сервера.
func (s *SQLiteStore) Close() error {
	return s.db.Close()
}

// Health проверяет доступность БД (лёгкий ping).
func (s *SQLiteStore) Health(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `SELECT 1`)
	return err
}

// RunInTransaction выполняет fn в одной транзакции; при ошибке откатывает.
func (s *SQLiteStore) RunInTransaction(ctx context.Context, fn func(Store) error) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if rbErr := tx.Rollback(); rbErr != nil && rbErr != sql.ErrTxDone && err == nil {
			err = rbErr
		}
	}()
	txStore := &sqliteTxStore{tx: tx}
	if err := fn(txStore); err != nil {
		return err
	}
	return tx.Commit()
}

// sqliteTxStore реализует Store поверх *sql.Tx для RunInTransaction.
type sqliteTxStore struct {
	tx *sql.Tx
}

func (s *sqliteTxStore) Health(ctx context.Context) error {
	_, err := s.tx.ExecContext(ctx, `SELECT 1`)
	return err
}

func (s *sqliteTxStore) UpsertSeries(ctx context.Context, m *models.Series) error {
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO series (id, name, season, type, country)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  season = excluded.season,
  type = excluded.type,
  country = excluded.country
`, m.ID, m.Name, m.Season, m.Type, m.Country)
	return err
}

// ListSeries возвращает все чемпионаты в БД (по одной строке на серию).
// Параметр season оставлен для совместимости API и игнорируется — сезон у каждой серии свой (например Super Formula 2025 при CurrentSeason 2026).
func (s *sqliteTxStore) ListSeries(ctx context.Context, season string) ([]models.Series, error) {
	_ = season
	rows, err := s.tx.QueryContext(ctx, `SELECT id, name, season, type, country FROM series ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var out []models.Series
	for rows.Next() {
		var m models.Series
		if err := rows.Scan(&m.ID, &m.Name, &m.Season, &m.Type, &m.Country); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *sqliteTxStore) UpsertEvent(ctx context.Context, e *models.Event) error {
	startStr := formatTime(e.StartDate)
	endStr := formatTime(e.EndDate)
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO events (id, series_id, season, name, location, circuit_name, start_date, end_date, time_est, time_msk)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  series_id = excluded.series_id, season = excluded.season, name = excluded.name,
  location = excluded.location, circuit_name = excluded.circuit_name,
  start_date = excluded.start_date, end_date = excluded.end_date,
  time_est = excluded.time_est, time_msk = excluded.time_msk
`, e.ID, e.SeriesID, e.Season, e.Name, e.Location, e.CircuitName, startStr, endStr, e.TimeEST, e.TimeMSK)
	return err
}

func (s *sqliteTxStore) ListEvents(ctx context.Context, seriesID, season string) ([]models.Event, error) {
	rows, err := s.tx.QueryContext(ctx, `
SELECT id, series_id, season, name, location, circuit_name, start_date, end_date, time_est, time_msk
FROM events WHERE series_id = ? AND season = ? ORDER BY start_date, id
`, seriesID, season)
	if err != nil {
		return nil, err
	}
	var out []models.Event
	for rows.Next() {
		var m models.Event
		var startStr, endStr *string
		if err := rows.Scan(&m.ID, &m.SeriesID, &m.Season, &m.Name, &m.Location, &m.CircuitName, &startStr, &endStr, &m.TimeEST, &m.TimeMSK); err != nil {
			_ = rows.Close()
			return nil, err
		}
		m.StartDate = parseTime(startStr)
		m.EndDate = parseTime(endStr)
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *sqliteTxStore) UpsertRace(ctx context.Context, r *models.Race) error {
	sched := formatTime(r.ScheduleAt)
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO races (id, event_id, series_id, season, name, schedule_at, laps, distance, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  event_id = excluded.event_id, series_id = excluded.series_id, season = excluded.season,
  name = excluded.name, schedule_at = excluded.schedule_at, laps = excluded.laps,
  distance = excluded.distance, status = excluded.status
`, r.ID, r.EventID, r.SeriesID, r.Season, r.Name, sched, r.Laps, r.Distance, r.Status)
	return err
}

func (s *sqliteTxStore) ListRacesByEvent(ctx context.Context, eventID string) ([]models.Race, error) {
	rows, err := s.tx.QueryContext(ctx, `SELECT id, event_id, series_id, season, name, schedule_at, laps, distance, status FROM races WHERE event_id = ? ORDER BY schedule_at, id`, eventID)
	if err != nil {
		return nil, err
	}
	var out []models.Race
	for rows.Next() {
		var m models.Race
		var schedStr *string
		if err := rows.Scan(&m.ID, &m.EventID, &m.SeriesID, &m.Season, &m.Name, &schedStr, &m.Laps, &m.Distance, &m.Status); err != nil {
			_ = rows.Close()
			return nil, err
		}
		m.ScheduleAt = parseTime(schedStr)
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *sqliteTxStore) UpsertDriver(ctx context.Context, d *models.Driver) error {
	birth := formatTime(d.BirthDate)
	slug := driverutil.Slug(d.Name)
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO drivers (id, name, short_name, nationality, number, birth_date, birth_place, slug)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name, short_name = excluded.short_name, nationality = excluded.nationality,
  number = excluded.number, birth_date = excluded.birth_date, birth_place = excluded.birth_place,
  slug = excluded.slug
`, d.ID, d.Name, d.ShortName, d.Nationality, d.Number, birth, nullEmpty(d.BirthPlace), slug)
	return err
}

func (s *sqliteTxStore) ListDrivers(ctx context.Context) ([]models.Driver, error) {
	rows, err := s.tx.QueryContext(ctx, `SELECT id, name, short_name, nationality, number, birth_date, birth_place FROM drivers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.Driver
	for rows.Next() {
		var d models.Driver
		var birthStr *string
		var birthPlace *string
		if err := rows.Scan(&d.ID, &d.Name, &d.ShortName, &d.Nationality, &d.Number, &birthStr, &birthPlace); err != nil {
			return nil, err
		}
		d.BirthDate = parseTime(birthStr)
		if birthPlace != nil {
			d.BirthPlace = *birthPlace
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *sqliteTxStore) GetDriversBySlug(ctx context.Context, slug string) ([]models.Driver, error) {
	rows, err := s.tx.QueryContext(ctx, `SELECT id, name, short_name, nationality, number, birth_date, birth_place FROM drivers WHERE slug = ? ORDER BY name`, slug)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.Driver
	for rows.Next() {
		var d models.Driver
		var birthStr *string
		var birthPlace *string
		if err := rows.Scan(&d.ID, &d.Name, &d.ShortName, &d.Nationality, &d.Number, &birthStr, &birthPlace); err != nil {
			return nil, err
		}
		d.BirthDate = parseTime(birthStr)
		if birthPlace != nil {
			d.BirthPlace = *birthPlace
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *sqliteTxStore) UpsertTeam(ctx context.Context, t *models.Team) error {
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO teams (id, name, country, car)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, country = excluded.country, car = excluded.car
`, t.ID, t.Name, t.Country, t.Car)
	return err
}

func (s *sqliteTxStore) ListTeams(ctx context.Context, idPrefix string) ([]models.Team, error) {
	var rows *sql.Rows
	var err error
	if idPrefix == "" {
		rows, err = s.tx.QueryContext(ctx, `SELECT id, name, country, car FROM teams ORDER BY name`)
	} else {
		rows, err = s.tx.QueryContext(ctx, `SELECT id, name, country, car FROM teams WHERE id LIKE ? ESCAPE '\' ORDER BY name`, escapeLike(idPrefix)+"%")
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanTeams(rows)
}

func (s *sqliteTxStore) UpsertResult(ctx context.Context, r *models.Result) error {
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO results (id, race_id, driver_id, team_id, car_number, position, grid_position, laps, laps_led, status, points, fastest_lap)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  race_id = excluded.race_id, driver_id = excluded.driver_id, team_id = excluded.team_id,
  car_number = excluded.car_number, position = excluded.position, grid_position = excluded.grid_position,
  laps = excluded.laps, laps_led = excluded.laps_led, status = excluded.status, points = excluded.points, fastest_lap = excluded.fastest_lap
`, r.ID, r.RaceID, r.DriverID, r.TeamID, r.CarNumber, r.Position, r.GridPosition, r.Laps, r.LapsLed, r.Status, r.Points, r.FastestLap)
	return err
}

func (s *sqliteTxStore) ListResultsByRace(ctx context.Context, raceID string) ([]models.Result, error) {
	rows, err := s.tx.QueryContext(ctx, `SELECT id, race_id, driver_id, team_id, car_number, position, grid_position, laps, laps_led, status, points, fastest_lap FROM results WHERE race_id = ? ORDER BY position, id`, raceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.Result
	for rows.Next() {
		var m models.Result
		if err := rows.Scan(&m.ID, &m.RaceID, &m.DriverID, &m.TeamID, &m.CarNumber, &m.Position, &m.GridPosition, &m.Laps, &m.LapsLed, &m.Status, &m.Points, &m.FastestLap); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *sqliteTxStore) ListDriverSeasonResults(ctx context.Context, driverIDs []string, season string) ([]models.DriverSeasonResult, error) {
	if len(driverIDs) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(driverIDs))
	args := make([]interface{}, 0, len(driverIDs)+1)
	for i := range driverIDs {
		placeholders[i] = "?"
		args = append(args, driverIDs[i])
	}
	args = append(args, season)
	//nolint:gosec // Query text is composed only of '?' placeholders, values are still parameterized.
	query := `
SELECT e.series_id, s.name, e.id, e.name, COALESCE(ra.name, e.name),
  COALESCE(r.position, 0), COALESCE(r.points, 0), COALESCE(r.laps, 0), COALESCE(r.status,''), COALESCE(r.car_number,'')
FROM results r
JOIN races ra ON r.race_id = ra.id
JOIN events e ON ra.event_id = e.id
JOIN series s ON e.series_id = s.id
WHERE r.driver_id IN (` + strings.Join(placeholders, ",") + `) AND e.season = ?
ORDER BY e.start_date, ra.id`
	rows, err := s.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.DriverSeasonResult
	for rows.Next() {
		var row models.DriverSeasonResult
		if err := rows.Scan(&row.SeriesID, &row.SeriesName, &row.EventID, &row.EventName, &row.RaceName,
			&row.Position, &row.Points, &row.Laps, &row.Status, &row.CarNumber); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (s *sqliteTxStore) UpsertStageResult(ctx context.Context, r *models.StageResult) error {
	_, err := s.tx.ExecContext(ctx, `
INSERT INTO stage_results (id, race_id, series_id, season, stage_no, driver_id, team_id, car_number, position, laps, status, points)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  race_id = excluded.race_id, series_id = excluded.series_id, season = excluded.season,
  stage_no = excluded.stage_no, driver_id = excluded.driver_id, team_id = excluded.team_id,
  car_number = excluded.car_number, position = excluded.position, laps = excluded.laps,
  status = excluded.status, points = excluded.points
`, r.ID, r.RaceID, r.SeriesID, r.Season, r.StageNo, r.DriverID, r.TeamID, r.CarNumber, r.Position, r.Laps, r.Status, r.Points)
	return err
}

func (s *sqliteTxStore) RunInTransaction(_ context.Context, fn func(Store) error) error {
	return fn(s)
}

const schemaVersion = 2

// initSchema создаёт таблицы и индексы; ведёт schema_version для миграций.
func initSchema(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 1)`); err != nil {
		return err
	}

	const schema = `
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  season TEXT NOT NULL,
  type TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  nationality TEXT,
  number TEXT,
  birth_date TEXT,
  birth_place TEXT,
  slug TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  car TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  circuit_name TEXT,
  start_date TEXT,
  end_date TEXT,
  time_est TEXT,
  time_msk TEXT
);

CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule_at TEXT,
  laps INTEGER,
  distance TEXT,
  status TEXT
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  driver_id TEXT REFERENCES drivers(id),
  team_id TEXT REFERENCES teams(id),
  car_number TEXT,
  position INTEGER,
  grid_position INTEGER,
  laps INTEGER,
  laps_led INTEGER,
  status TEXT,
  points REAL,
  fastest_lap TEXT
);

CREATE TABLE IF NOT EXISTS stage_results (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  stage_no INTEGER NOT NULL,
  driver_id TEXT REFERENCES drivers(id),
  team_id TEXT REFERENCES teams(id),
  car_number TEXT,
  position INTEGER,
  laps INTEGER,
  status TEXT,
  points INTEGER
);

	DROP VIEW IF EXISTS driver_stats_stockcar;
	CREATE VIEW driver_stats_stockcar AS
	WITH base AS (
	  SELECT
	    e.series_id AS series_id,
	    e.season AS season,
	    r.race_id AS race_id,
	    COALESCE(d.id, '') AS driver_id,
	    COALESCE(d.name, '') AS driver_name,
	    COALESCE(t.name, '') AS team_name,
	    COALESCE(t.car, '') AS manufacturer,
	    COALESCE(r.car_number, '') AS car_number,
	    r.position,
	    r.grid_position,
	    r.laps,
	    COALESCE(r.laps_led, 0) AS laps_led,
	    ra.laps AS race_laps,
	    LOWER(COALESCE(r.status, '')) AS status
	  FROM results r
	  JOIN races ra ON r.race_id = ra.id
	  JOIN events e ON ra.event_id = e.id
	  LEFT JOIN drivers d ON r.driver_id = d.id
	  LEFT JOIN teams t ON r.team_id = t.id
	  WHERE NOT (
	    UPPER(e.series_id) = 'NASCAR_CUP' AND substr(e.id, -1, 1) = '0'
	  )
	    AND (UPPER(e.series_id) <> 'NASCAR_CUP' OR DATE(e.start_date) <= DATE('now'))
	),
	stage_per_race AS (
	  SELECT
	    sr.race_id,
	    sr.driver_id,
	    SUM(CASE WHEN sr.position = 1 THEN 1 ELSE 0 END) AS stage_wins,
	    SUM(COALESCE(sr.points, 0)) AS stage_points
	  FROM stage_results sr
	  GROUP BY sr.race_id, sr.driver_id
	)
	SELECT
	  b.series_id AS series_id,
	  b.season AS season,
	  b.driver_id AS driver_id,
	  b.driver_name AS driver_name,
	  b.team_name AS team_name,
	  b.manufacturer AS manufacturer,
	  b.car_number AS car_number,
	  COUNT(*) AS races,
	  SUM(CASE WHEN b.position = 1 THEN 1 ELSE 0 END) AS wins,
	  SUM(CASE WHEN b.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
	  SUM(CASE WHEN b.position BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS top5,
	  SUM(CASE WHEN b.position BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS top10,
	  SUM(CASE WHEN b.position BETWEEN 1 AND 15 THEN 1 ELSE 0 END) AS top15,
	  SUM(CASE WHEN b.position BETWEEN 1 AND 20 THEN 1 ELSE 0 END) AS top20,
	  AVG(NULLIF(b.position, 0)) AS avg_finish,
	  AVG(NULLIF(b.grid_position, 0)) AS avg_start,
	  COALESCE(SUM(sp.stage_wins), 0) AS stage_wins,
	  COALESCE(SUM(sp.stage_points), 0) AS stage_points,
	  CASE
	    WHEN COUNT(*) > 0
	    THEN (1.0 * COALESCE(SUM(sp.stage_points), 0)) / COUNT(*)
	    ELSE 0
	  END AS avg_stage_points,
	  SUM(b.laps_led) AS laps_led,
	  100.0 * SUM(b.laps) / NULLIF(SUM(CASE WHEN b.race_laps > 0 THEN b.race_laps ELSE 0 END), 0) AS laps_completed_pct,
	  AVG(
	    CASE
	      WHEN b.grid_position > 0 AND b.position > 0
	      THEN CAST(b.grid_position - b.position AS REAL)
	    END
	  ) AS pos_diff
	FROM base b
	LEFT JOIN stage_per_race sp ON sp.race_id = b.race_id AND sp.driver_id = b.driver_id
	GROUP BY
	  b.series_id, b.season, b.driver_id, b.driver_name, b.team_name, b.manufacturer, b.car_number;

CREATE INDEX IF NOT EXISTS idx_events_series_season ON events(series_id, season);
CREATE INDEX IF NOT EXISTS idx_races_event ON races(event_id);
CREATE INDEX IF NOT EXISTS idx_results_race ON results(race_id);
CREATE INDEX IF NOT EXISTS idx_stage_results_race ON stage_results(race_id);
CREATE INDEX IF NOT EXISTS idx_drivers_slug ON drivers(slug);
CREATE INDEX IF NOT EXISTS idx_series_season ON series(season);
CREATE INDEX IF NOT EXISTS idx_results_driver ON results(driver_id);
CREATE INDEX IF NOT EXISTS idx_events_season_series_date ON events(season, series_id, start_date);
CREATE INDEX IF NOT EXISTS idx_results_driver_season ON results(driver_id, race_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_results_unique_race_driver ON results(race_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stage_results_unique_race_stage_driver ON stage_results(race_id, stage_no, driver_id) WHERE driver_id IS NOT NULL;
`
	stmts := strings.Split(schema, ";\n")
	for _, raw := range stmts {
		stmt := strings.TrimSpace(raw)
		if stmt == "" {
			continue
		}
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return runMigrations(db)
}

// runMigrations выполняет миграции с (current+1) по schemaVersion.
func runMigrations(db *sql.DB) error {
	var current int
	if err := db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&current); err != nil {
		return err
	}
	for v := 1; v <= schemaVersion; v++ {
		if current >= v {
			continue
		}
		if err := runMigration(db, v); err != nil {
			return err
		}
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v); err != nil {
			return err
		}
	}
	return nil
}

func runMigration(db *sql.DB, version int) error {
	switch version {
	case 1:
		if _, err := db.Exec(`ALTER TABLE drivers ADD COLUMN birth_place TEXT`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
		if _, err := db.Exec(`ALTER TABLE drivers ADD COLUMN slug TEXT`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
		if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_drivers_slug ON drivers(slug)`); err != nil {
			return err
		}
		return backfillDriverSlugs(db)
	case 2:
		if _, err := db.Exec(`ALTER TABLE results ADD COLUMN laps_led INTEGER DEFAULT 0`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
		if _, err := db.Exec(`DROP VIEW IF EXISTS driver_stats_stockcar`); err != nil {
			return err
		}
		if _, err := db.Exec(`
CREATE VIEW driver_stats_stockcar AS
WITH base AS (
  SELECT
    e.series_id AS series_id,
    e.season AS season,
    r.race_id AS race_id,
    COALESCE(d.id, '') AS driver_id,
    COALESCE(d.name, '') AS driver_name,
    COALESCE(t.name, '') AS team_name,
    COALESCE(t.car, '') AS manufacturer,
    COALESCE(r.car_number, '') AS car_number,
    r.position,
    r.grid_position,
    r.laps,
    COALESCE(r.laps_led, 0) AS laps_led,
    ra.laps AS race_laps,
    LOWER(COALESCE(r.status, '')) AS status
  FROM results r
  JOIN races ra ON r.race_id = ra.id
  JOIN events e ON ra.event_id = e.id
  LEFT JOIN drivers d ON r.driver_id = d.id
  LEFT JOIN teams t ON r.team_id = t.id
  WHERE NOT (
    UPPER(e.series_id) = 'NASCAR_CUP' AND substr(e.id, -1, 1) = '0'
  )
    AND (UPPER(e.series_id) <> 'NASCAR_CUP' OR DATE(e.start_date) <= DATE('now'))
),
stage_per_race AS (
  SELECT
    sr.race_id,
    sr.driver_id,
    SUM(CASE WHEN sr.position = 1 THEN 1 ELSE 0 END) AS stage_wins,
    SUM(COALESCE(sr.points, 0)) AS stage_points
  FROM stage_results sr
  GROUP BY sr.race_id, sr.driver_id
)
SELECT
  b.series_id AS series_id,
  b.season AS season,
  b.driver_id AS driver_id,
  b.driver_name AS driver_name,
  b.team_name AS team_name,
  b.manufacturer AS manufacturer,
  b.car_number AS car_number,
  COUNT(*) AS races,
  SUM(CASE WHEN b.position = 1 THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN b.grid_position = 1 THEN 1 ELSE 0 END) AS poles,
  SUM(CASE WHEN b.position BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS top5,
  SUM(CASE WHEN b.position BETWEEN 1 AND 10 THEN 1 ELSE 0 END) AS top10,
  SUM(CASE WHEN b.position BETWEEN 1 AND 15 THEN 1 ELSE 0 END) AS top15,
  SUM(CASE WHEN b.position BETWEEN 1 AND 20 THEN 1 ELSE 0 END) AS top20,
  AVG(NULLIF(b.position, 0)) AS avg_finish,
  AVG(NULLIF(b.grid_position, 0)) AS avg_start,
  COALESCE(SUM(sp.stage_wins), 0) AS stage_wins,
  COALESCE(SUM(sp.stage_points), 0) AS stage_points,
  CASE
    WHEN COUNT(*) > 0
    THEN (1.0 * COALESCE(SUM(sp.stage_points), 0)) / COUNT(*)
    ELSE 0
  END AS avg_stage_points,
  SUM(b.laps_led) AS laps_led,
  100.0 * SUM(b.laps) / NULLIF(SUM(CASE WHEN b.race_laps > 0 THEN b.race_laps ELSE 0 END), 0) AS laps_completed_pct,
  AVG(
    CASE
      WHEN b.grid_position > 0 AND b.position > 0
      THEN CAST(b.grid_position - b.position AS REAL)
    END
  ) AS pos_diff
FROM base b
LEFT JOIN stage_per_race sp ON sp.race_id = b.race_id AND sp.driver_id = b.driver_id
GROUP BY
  b.series_id, b.season, b.driver_id, b.driver_name, b.team_name, b.manufacturer, b.car_number`); err != nil {
			return err
		}
		return nil
	default:
		return nil
	}
}

// backfillDriverSlugs заполняет slug для записей, где он пустой (батч через временную таблицу).
func backfillDriverSlugs(db *sql.DB) (err error) {
	rows, err := db.Query(`SELECT id, name FROM drivers WHERE slug IS NULL OR slug = ''`)
	if err != nil {
		return err
	}
	var pairs []struct{ id, slug string }
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			_ = rows.Close()
			return err
		}
		pairs = append(pairs, struct{ id, slug string }{id, driverutil.Slug(name)})
	}
	_ = rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	if len(pairs) == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if rbErr := tx.Rollback(); rbErr != nil && rbErr != sql.ErrTxDone && err == nil {
			err = rbErr
		}
	}()
	if _, err := tx.Exec(`CREATE TEMP TABLE _driver_slugs (id TEXT PRIMARY KEY, slug TEXT)`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO _driver_slugs (id, slug) VALUES (?, ?)`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()
	for _, p := range pairs {
		if _, err := stmt.Exec(p.id, p.slug); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE drivers SET slug = (SELECT slug FROM _driver_slugs WHERE _driver_slugs.id = drivers.id) WHERE id IN (SELECT id FROM _driver_slugs)`); err != nil {
		return err
	}
	return tx.Commit()
}

// --- helpers ---

func formatTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

func parseTime(s *string) time.Time {
	if s == nil || *s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func nullEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// escapeLike escapes LIKE wildcards (%, _, \) for safe prefix matching.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// --- Series ---

// UpsertSeries inserts or updates a championship series.
func (s *SQLiteStore) UpsertSeries(ctx context.Context, m *models.Series) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO series (id, name, season, type, country)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  season = excluded.season,
  type = excluded.type,
  country = excluded.country
`, m.ID, m.Name, m.Season, m.Type, m.Country)
	return err
}

// ListSeries returns all series records.
func (s *SQLiteStore) ListSeries(ctx context.Context, season string) ([]models.Series, error) {
	_ = season
	rows, err := s.db.QueryContext(ctx, `
SELECT id, name, season, type, country
FROM series
ORDER BY name
`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []models.Series
	for rows.Next() {
		var m models.Series
		if err := rows.Scan(&m.ID, &m.Name, &m.Season, &m.Type, &m.Country); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// --- Events ---

// UpsertEvent inserts or updates an event.
func (s *SQLiteStore) UpsertEvent(ctx context.Context, e *models.Event) error {
	startStr := formatTime(e.StartDate)
	endStr := formatTime(e.EndDate)

	_, err := s.db.ExecContext(ctx, `
INSERT INTO events (id, series_id, season, name, location, circuit_name, start_date, end_date, time_est, time_msk)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  series_id = excluded.series_id,
  season = excluded.season,
  name = excluded.name,
  location = excluded.location,
  circuit_name = excluded.circuit_name,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  time_est = excluded.time_est,
  time_msk = excluded.time_msk
`, e.ID, e.SeriesID, e.Season, e.Name, e.Location, e.CircuitName, startStr, endStr, e.TimeEST, e.TimeMSK)
	return err
}

// ListEvents returns events for a series and season.
func (s *SQLiteStore) ListEvents(ctx context.Context, seriesID, season string) ([]models.Event, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, series_id, season, name, location, circuit_name, start_date, end_date, time_est, time_msk
FROM events
WHERE series_id = ? AND season = ?
ORDER BY start_date, id
`, seriesID, season)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []models.Event
	for rows.Next() {
		var (
			m        models.Event
			startStr *string
			endStr   *string
		)
		if err := rows.Scan(&m.ID, &m.SeriesID, &m.Season, &m.Name, &m.Location, &m.CircuitName, &startStr, &endStr, &m.TimeEST, &m.TimeMSK); err != nil {
			return nil, err
		}
		m.StartDate = parseTime(startStr)
		m.EndDate = parseTime(endStr)
		out = append(out, m)
	}
	return out, rows.Err()
}

// --- Races ---

// UpsertRace inserts or updates a race.
func (s *SQLiteStore) UpsertRace(ctx context.Context, r *models.Race) error {
	sched := formatTime(r.ScheduleAt)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO races (id, event_id, series_id, season, name, schedule_at, laps, distance, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  event_id = excluded.event_id,
  series_id = excluded.series_id,
  season = excluded.season,
  name = excluded.name,
  schedule_at = excluded.schedule_at,
  laps = excluded.laps,
  distance = excluded.distance,
  status = excluded.status
`, r.ID, r.EventID, r.SeriesID, r.Season, r.Name, sched, r.Laps, r.Distance, r.Status)
	return err
}

// ListRacesByEvent returns races for the provided event.
func (s *SQLiteStore) ListRacesByEvent(ctx context.Context, eventID string) ([]models.Race, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, event_id, series_id, season, name, schedule_at, laps, distance, status
FROM races
WHERE event_id = ?
ORDER BY schedule_at, id
`, eventID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []models.Race
	for rows.Next() {
		var (
			m        models.Race
			schedStr *string
		)
		if err := rows.Scan(&m.ID, &m.EventID, &m.SeriesID, &m.Season, &m.Name, &schedStr, &m.Laps, &m.Distance, &m.Status); err != nil {
			return nil, err
		}
		m.ScheduleAt = parseTime(schedStr)
		out = append(out, m)
	}
	return out, rows.Err()
}

// --- Drivers & Teams ---

// UpsertDriver inserts or updates a driver.
func (s *SQLiteStore) UpsertDriver(ctx context.Context, d *models.Driver) error {
	birth := formatTime(d.BirthDate)
	slug := driverutil.Slug(d.Name)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO drivers (id, name, short_name, nationality, number, birth_date, birth_place, slug)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  short_name = excluded.short_name,
  nationality = excluded.nationality,
  number = excluded.number,
  birth_date = excluded.birth_date,
  birth_place = excluded.birth_place,
  slug = excluded.slug
`, d.ID, d.Name, d.ShortName, d.Nationality, d.Number, birth, nullEmpty(d.BirthPlace), slug)
	return err
}

// ListDrivers returns all drivers.
func (s *SQLiteStore) ListDrivers(ctx context.Context) ([]models.Driver, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, short_name, nationality, number, birth_date, birth_place FROM drivers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.Driver
	for rows.Next() {
		var d models.Driver
		var birthStr *string
		var birthPlace *string
		if err := rows.Scan(&d.ID, &d.Name, &d.ShortName, &d.Nationality, &d.Number, &birthStr, &birthPlace); err != nil {
			return nil, err
		}
		d.BirthDate = parseTime(birthStr)
		if birthPlace != nil {
			d.BirthPlace = *birthPlace
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDriversBySlug returns drivers matching the given slug.
func (s *SQLiteStore) GetDriversBySlug(ctx context.Context, slug string) ([]models.Driver, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, short_name, nationality, number, birth_date, birth_place FROM drivers WHERE slug = ? ORDER BY name`, slug)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.Driver
	for rows.Next() {
		var d models.Driver
		var birthStr *string
		var birthPlace *string
		if err := rows.Scan(&d.ID, &d.Name, &d.ShortName, &d.Nationality, &d.Number, &birthStr, &birthPlace); err != nil {
			return nil, err
		}
		d.BirthDate = parseTime(birthStr)
		if birthPlace != nil {
			d.BirthPlace = *birthPlace
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// UpsertTeam inserts or updates a team.
func (s *SQLiteStore) UpsertTeam(ctx context.Context, t *models.Team) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO teams (id, name, country, car)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  country = excluded.country,
  car = excluded.car
`, t.ID, t.Name, t.Country, t.Car)
	return err
}

// ListTeams returns teams filtered by ID prefix.
func (s *SQLiteStore) ListTeams(ctx context.Context, idPrefix string) ([]models.Team, error) {
	var rows *sql.Rows
	var err error
	if idPrefix == "" {
		rows, err = s.db.QueryContext(ctx, `SELECT id, name, country, car FROM teams ORDER BY name`)
	} else {
		rows, err = s.db.QueryContext(ctx, `SELECT id, name, country, car FROM teams WHERE id LIKE ? ESCAPE '\' ORDER BY name`, escapeLike(idPrefix)+"%")
	}
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanTeams(rows)
}

func scanTeams(rows *sql.Rows) ([]models.Team, error) {
	var out []models.Team
	for rows.Next() {
		var t models.Team
		var country, car *string
		if err := rows.Scan(&t.ID, &t.Name, &country, &car); err != nil {
			return nil, err
		}
		if country != nil {
			t.Country = *country
		}
		if car != nil {
			t.Car = *car
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// --- Results ---

// UpsertResult inserts or updates a race result.
func (s *SQLiteStore) UpsertResult(ctx context.Context, r *models.Result) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO results (id, race_id, driver_id, team_id, car_number, position, grid_position, laps, laps_led, status, points, fastest_lap)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  race_id = excluded.race_id,
  driver_id = excluded.driver_id,
  team_id = excluded.team_id,
  car_number = excluded.car_number,
  position = excluded.position,
  grid_position = excluded.grid_position,
  laps = excluded.laps,
  laps_led = excluded.laps_led,
  status = excluded.status,
  points = excluded.points,
  fastest_lap = excluded.fastest_lap
`, r.ID, r.RaceID, r.DriverID, r.TeamID, r.CarNumber, r.Position, r.GridPosition, r.Laps, r.LapsLed, r.Status, r.Points, r.FastestLap)
	return err
}

// ListResultsByRace returns all results for a race.
func (s *SQLiteStore) ListResultsByRace(ctx context.Context, raceID string) ([]models.Result, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT id, race_id, driver_id, team_id, car_number, position, grid_position, laps, laps_led, status, points, fastest_lap
FROM results
WHERE race_id = ?
ORDER BY position, id
`, raceID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []models.Result
	for rows.Next() {
		var m models.Result
		if err := rows.Scan(&m.ID, &m.RaceID, &m.DriverID, &m.TeamID, &m.CarNumber, &m.Position, &m.GridPosition, &m.Laps, &m.LapsLed, &m.Status, &m.Points, &m.FastestLap); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListDriverSeasonResults returns race results for drivers in a season.
func (s *SQLiteStore) ListDriverSeasonResults(ctx context.Context, driverIDs []string, season string) ([]models.DriverSeasonResult, error) {
	if len(driverIDs) == 0 {
		return nil, nil
	}
	placeholders := make([]string, len(driverIDs))
	args := make([]interface{}, 0, len(driverIDs)+1)
	for i := range driverIDs {
		placeholders[i] = "?"
		args = append(args, driverIDs[i])
	}
	args = append(args, season)
	//nolint:gosec // Query text is composed only of '?' placeholders, values are still parameterized.
	query := `
SELECT e.series_id, s.name, e.id, e.name, COALESCE(ra.name, e.name),
  COALESCE(r.position, 0), COALESCE(r.points, 0), COALESCE(r.laps, 0), COALESCE(r.status,''), COALESCE(r.car_number,'')
FROM results r
JOIN races ra ON r.race_id = ra.id
JOIN events e ON ra.event_id = e.id
JOIN series s ON e.series_id = s.id
WHERE r.driver_id IN (` + strings.Join(placeholders, ",") + `) AND e.season = ?
ORDER BY e.start_date, ra.id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []models.DriverSeasonResult
	for rows.Next() {
		var row models.DriverSeasonResult
		if err := rows.Scan(&row.SeriesID, &row.SeriesName, &row.EventID, &row.EventName, &row.RaceName,
			&row.Position, &row.Points, &row.Laps, &row.Status, &row.CarNumber); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// --- Stage Results ---

// UpsertStageResult inserts or updates a stage result.
func (s *SQLiteStore) UpsertStageResult(ctx context.Context, r *models.StageResult) error {
	_, err := s.db.ExecContext(ctx, `
INSERT INTO stage_results (id, race_id, series_id, season, stage_no, driver_id, team_id, car_number, position, laps, status, points)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  race_id = excluded.race_id,
  series_id = excluded.series_id,
  season = excluded.season,
  stage_no = excluded.stage_no,
  driver_id = excluded.driver_id,
  team_id = excluded.team_id,
  car_number = excluded.car_number,
  position = excluded.position,
  laps = excluded.laps,
  status = excluded.status,
  points = excluded.points
`, r.ID, r.RaceID, r.SeriesID, r.Season, r.StageNo, r.DriverID, r.TeamID, r.CarNumber, r.Position, r.Laps, r.Status, r.Points)
	return err
}

