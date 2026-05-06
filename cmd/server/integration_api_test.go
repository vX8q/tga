package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/models"
)

type failingDriverStore struct {
	store.NoopStore
}

func (f failingDriverStore) GetDriversBySlug(_ context.Context, _ string) ([]models.Driver, error) {
	return nil, errors.New("db unavailable")
}

func TestIntegrationAPI_SeriesListHappyPath(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/series", nil)
	rec := httptest.NewRecorder()

	handleSeriesList(rec, req, store.NoopStore{})

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body []map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body) == 0 {
		t.Fatal("series list is empty")
	}
}

func TestIntegrationAPI_EventUnknown404(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/events/UNKNOWN_EVENT_999", nil)
	rec := httptest.NewRecorder()

	handleEvent(rec, req, t.TempDir(), nil)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestIntegrationAPI_DriverHappyPath(t *testing.T) {
	st, err := store.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	defer func() { _ = st.Close() }()

	ctx := context.Background()
	if err := st.UpsertDriver(ctx, &models.Driver{
		ID:          "F1:DRIVER:lewis_hamilton",
		Name:        "Lewis Hamilton",
		Nationality: "British",
		BirthDate:   time.Date(1985, 1, 7, 0, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("UpsertDriver: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/driver/lewis-hamilton", nil)
	rec := httptest.NewRecorder()
	handleDriverBySlug(rec, req, t.TempDir(), st)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestIntegrationAPI_DriverStoreError500(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/driver/lewis-hamilton", nil)
	rec := httptest.NewRecorder()

	handleDriverBySlug(rec, req, t.TempDir(), failingDriverStore{})

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}
