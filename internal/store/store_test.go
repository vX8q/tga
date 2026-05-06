package store

import (
	"context"
	"testing"
	"time"

	"github.com/vX8q/tga/models"
)

func TestSQLiteStore_Memory(t *testing.T) {
	ctx := context.Background()
	st, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	defer func() { _ = st.Close() }()

	if err := st.Health(ctx); err != nil {
		t.Errorf("Health: %v", err)
	}

	// Series
	series := &models.Series{ID: "F1", Name: "Formula 1", Season: "2026", Type: "openwheel", Country: "World"}
	if err := st.UpsertSeries(ctx, series); err != nil {
		t.Fatalf("UpsertSeries: %v", err)
	}
	list, err := st.ListSeries(ctx, "2026")
	if err != nil {
		t.Fatalf("ListSeries: %v", err)
	}
	if len(list) != 1 || list[0].ID != "F1" {
		t.Errorf("ListSeries: got %v", list)
	}

	// Driver with slug
	driver := &models.Driver{ID: "F1:DRIVER:lewis_hamilton", Name: "Lewis Hamilton", Nationality: "British"}
	if err := st.UpsertDriver(ctx, driver); err != nil {
		t.Fatalf("UpsertDriver: %v", err)
	}
	bySlug, err := st.GetDriversBySlug(ctx, "lewis-hamilton")
	if err != nil {
		t.Fatalf("GetDriversBySlug: %v", err)
	}
	if len(bySlug) != 1 || bySlug[0].Name != "Lewis Hamilton" {
		t.Errorf("GetDriversBySlug: got %v", bySlug)
	}

	// Transaction
	err = st.RunInTransaction(ctx, func(tx Store) error {
		s2 := &models.Series{ID: "F2", Name: "Formula 2", Season: "2026", Type: "openwheel", Country: "World"}
		return tx.UpsertSeries(ctx, s2)
	})
	if err != nil {
		t.Fatalf("RunInTransaction: %v", err)
	}
	list, _ = st.ListSeries(ctx, "2026")
	if len(list) != 2 {
		t.Errorf("after tx ListSeries: got %d", len(list))
	}
}

func TestSQLiteStore_EventRaceResult(t *testing.T) {
	ctx := context.Background()
	st, err := NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	defer func() { _ = st.Close() }()

	// Series + Event + Race + Result
	_ = st.UpsertSeries(ctx, &models.Series{ID: "F1", Name: "F1", Season: "2026", Type: "openwheel", Country: "World"})
	start := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC)
	ev := &models.Event{ID: "F1_2026_1", SeriesID: "F1", Season: "2026", Name: "Bahrain", StartDate: start, EndDate: end}
	if err := st.UpsertEvent(ctx, ev); err != nil {
		t.Fatalf("UpsertEvent: %v", err)
	}
	events, err := st.ListEvents(ctx, "F1", "2026")
	if err != nil || len(events) != 1 {
		t.Fatalf("ListEvents: %v, len=%d", err, len(events))
	}

	race := &models.Race{ID: "F1_2026_1:RACE", EventID: "F1_2026_1", SeriesID: "F1", Season: "2026", Name: "Race"}
	if err := st.UpsertRace(ctx, race); err != nil {
		t.Fatalf("UpsertRace: %v", err)
	}
	races, err := st.ListRacesByEvent(ctx, "F1_2026_1")
	if err != nil || len(races) != 1 {
		t.Fatalf("ListRacesByEvent: %v", err)
	}

	_ = st.UpsertDriver(ctx, &models.Driver{ID: "F1:DRIVER:max_verstappen", Name: "Max Verstappen"})
	_ = st.UpsertTeam(ctx, &models.Team{ID: "F1:TEAM:red_bull", Name: "Red Bull"})
	res := &models.Result{ID: "F1_2026_1:RACE:1", RaceID: "F1_2026_1:RACE", DriverID: "F1:DRIVER:max_verstappen", TeamID: "F1:TEAM:red_bull", Position: 1, Points: 25}
	if err := st.UpsertResult(ctx, res); err != nil {
		t.Fatalf("UpsertResult: %v", err)
	}
	results, err := st.ListResultsByRace(ctx, "F1_2026_1:RACE")
	if err != nil || len(results) != 1 || results[0].Position != 1 {
		t.Fatalf("ListResultsByRace: %v, %v", err, results)
	}
}
