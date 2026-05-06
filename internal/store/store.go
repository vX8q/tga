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

// Health always reports healthy for NoopStore.
func (NoopStore) Health(_ context.Context) error { return nil }

// UpsertSeries is a no-op for NoopStore.
func (NoopStore) UpsertSeries(_ context.Context, _ *models.Series) error { return nil }
// ListSeries returns no rows for NoopStore.
func (NoopStore) ListSeries(_ context.Context, _ string) ([]models.Series, error) {
	return nil, nil
}
// UpsertEvent is a no-op for NoopStore.
func (NoopStore) UpsertEvent(_ context.Context, _ *models.Event) error { return nil }
// ListEvents returns no rows for NoopStore.
func (NoopStore) ListEvents(_ context.Context, _, _ string) ([]models.Event, error) {
	return nil, nil
}
// UpsertRace is a no-op for NoopStore.
func (NoopStore) UpsertRace(_ context.Context, _ *models.Race) error { return nil }
// ListRacesByEvent returns no rows for NoopStore.
func (NoopStore) ListRacesByEvent(_ context.Context, _ string) ([]models.Race, error) {
	return nil, nil
}
// UpsertDriver is a no-op for NoopStore.
func (NoopStore) UpsertDriver(_ context.Context, _ *models.Driver) error { return nil }
// ListDrivers returns no rows for NoopStore.
func (NoopStore) ListDrivers(_ context.Context) ([]models.Driver, error) { return nil, nil }
// GetDriversBySlug returns no rows for NoopStore.
func (NoopStore) GetDriversBySlug(_ context.Context, _ string) ([]models.Driver, error) {
	return nil, nil
}
// UpsertTeam is a no-op for NoopStore.
func (NoopStore) UpsertTeam(_ context.Context, _ *models.Team) error { return nil }
// ListTeams returns no rows for NoopStore.
func (NoopStore) ListTeams(_ context.Context, _ string) ([]models.Team, error) {
	return nil, nil
}
// UpsertResult is a no-op for NoopStore.
func (NoopStore) UpsertResult(_ context.Context, _ *models.Result) error { return nil }
// ListResultsByRace returns no rows for NoopStore.
func (NoopStore) ListResultsByRace(_ context.Context, _ string) ([]models.Result, error) {
	return nil, nil
}
// ListDriverSeasonResults returns no rows for NoopStore.
func (NoopStore) ListDriverSeasonResults(_ context.Context, _ []string, _ string) ([]models.DriverSeasonResult, error) {
	return nil, nil
}
// UpsertStageResult is a no-op for NoopStore.
func (NoopStore) UpsertStageResult(_ context.Context, _ *models.StageResult) error {
	return nil
}

// RunInTransaction executes callback directly for NoopStore.
func (NoopStore) RunInTransaction(_ context.Context, fn func(Store) error) error {
	return fn(NoopStore{})
}
