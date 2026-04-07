package store

import (
	"context"

	"github.com/vX8q/tga/models"
)

// Store — интерфейс доступа к данным (БД). Реализация — SQLite/Postgres и т.д.
type Store interface {
	// Health проверяет доступность хранилища (например SELECT 1). Для NoopStore — всегда nil.
	Health(ctx context.Context) error

	// Series
	UpsertSeries(ctx context.Context, s *models.Series) error
	// ListSeries возвращает все серии в БД; season в сигнатуре игнорируется (см. sqlite).
	ListSeries(ctx context.Context, season string) ([]models.Series, error)

	// Events
	UpsertEvent(ctx context.Context, e *models.Event) error
	ListEvents(ctx context.Context, seriesID, season string) ([]models.Event, error)

	// Races
	UpsertRace(ctx context.Context, r *models.Race) error
	ListRacesByEvent(ctx context.Context, eventID string) ([]models.Race, error)

	// Drivers & Teams
	UpsertDriver(ctx context.Context, d *models.Driver) error
	ListDrivers(ctx context.Context) ([]models.Driver, error)
	GetDriversBySlug(ctx context.Context, slug string) ([]models.Driver, error)
	UpsertTeam(ctx context.Context, t *models.Team) error
	ListTeams(ctx context.Context, idPrefix string) ([]models.Team, error)

	// Results
	UpsertResult(ctx context.Context, r *models.Result) error
	ListResultsByRace(ctx context.Context, raceID string) ([]models.Result, error)
	// ListDriverSeasonResults возвращает результаты гонок пилота за сезон (по списку driver_id, т.к. один человек может быть в разных сериях).
	ListDriverSeasonResults(ctx context.Context, driverIDs []string, season string) ([]models.DriverSeasonResult, error)

	// Stage Results
	UpsertStageResult(ctx context.Context, r *models.StageResult) error

	// RunInTransaction выполняет fn в одной транзакции. При ошибке из fn откатывается.
	// NoopStore выполняет fn без транзакции.
	RunInTransaction(ctx context.Context, fn func(Store) error) error
}

// NoopStore — заглушка до появления реальной БД
type NoopStore struct{}

func (NoopStore) Health(ctx context.Context) error { return nil }

func (NoopStore) UpsertSeries(ctx context.Context, s *models.Series) error   { return nil }
func (NoopStore) ListSeries(ctx context.Context, season string) ([]models.Series, error) {
	return nil, nil
}
func (NoopStore) UpsertEvent(ctx context.Context, e *models.Event) error     { return nil }
func (NoopStore) ListEvents(ctx context.Context, seriesID, season string) ([]models.Event, error) {
	return nil, nil
}
func (NoopStore) UpsertRace(ctx context.Context, r *models.Race) error       { return nil }
func (NoopStore) ListRacesByEvent(ctx context.Context, eventID string) ([]models.Race, error) {
	return nil, nil
}
func (NoopStore) UpsertDriver(ctx context.Context, d *models.Driver) error   { return nil }
func (NoopStore) ListDrivers(ctx context.Context) ([]models.Driver, error)   { return nil, nil }
func (NoopStore) GetDriversBySlug(ctx context.Context, slug string) ([]models.Driver, error) {
	return nil, nil
}
func (NoopStore) UpsertTeam(ctx context.Context, t *models.Team) error { return nil }
func (NoopStore) ListTeams(ctx context.Context, idPrefix string) ([]models.Team, error) {
	return nil, nil
}
func (NoopStore) UpsertResult(ctx context.Context, r *models.Result) error   { return nil }
func (NoopStore) ListResultsByRace(ctx context.Context, raceID string) ([]models.Result, error) {
	return nil, nil
}
func (NoopStore) ListDriverSeasonResults(ctx context.Context, driverIDs []string, season string) ([]models.DriverSeasonResult, error) {
	return nil, nil
}
func (NoopStore) UpsertStageResult(ctx context.Context, r *models.StageResult) error {
	return nil
}

func (NoopStore) RunInTransaction(ctx context.Context, fn func(Store) error) error {
	return fn(NoopStore{})
}
