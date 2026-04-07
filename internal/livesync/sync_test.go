package livesync

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/vX8q/tga/internal/schedulefile"
)

func TestFindEventByDate_ExactMatch(t *testing.T) {
	events := []schedulefile.EventJSON{
		{ID: "E1", StartDate: "2026-03-01"},
		{ID: "E2", StartDate: "2026-03-08"},
	}
	id := findEventByDate(events, "2026-03-08T10:00:00Z", false)
	if id != "E2" {
		t.Fatalf("findEventByDate exact = %q, want %q", id, "E2")
	}
}

func TestFindEventByDate_WeekendFallback(t *testing.T) {
	events := []schedulefile.EventJSON{
		{ID: "E1", StartDate: "2026-03-01"}, // воскресенье
	}
	// Сессия в пятницу того же уикенда.
	id := findEventByDate(events, "2026-02-28", true)
	if id != "E1" {
		t.Fatalf("findEventByDate weekend = %q, want %q", id, "E1")
	}
}

func TestMergeLiveJSONNASCAR_FilterAndAppend(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "live.json")
	if err := os.WriteFile(path, []byte(`["F1_2026_1","NASCAR_CUP_2026_1"]`), 0o644); err != nil {
		t.Fatalf("write seed live.json: %v", err)
	}
	if err := mergeLiveJSONNASCAR(path, []string{"NASCAR_CUP_2026_2"}); err != nil {
		t.Fatalf("mergeLiveJSONNASCAR error: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read live.json: %v", err)
	}
	// Ожидаем, что F1 остался, старый NASCAR удалён, добавлен новый.
	const want = "[\n  \"F1_2026_1\",\n  \"NASCAR_CUP_2026_2\"\n]"
	if string(got) != want {
		t.Fatalf("live.json = %s, want %s", string(got), want)
	}
}

func TestMergeLiveJSONF1_FilterAndAppend(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "live.json")
	if err := os.WriteFile(path, []byte(`["F1_2026_1","NASCAR_CUP_2026_1"]`), 0o644); err != nil {
		t.Fatalf("write seed live.json: %v", err)
	}
	if err := mergeLiveJSONF1(path, []string{"F1_2026_2"}); err != nil {
		t.Fatalf("mergeLiveJSONF1 error: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read live.json: %v", err)
	}
	// Ожидаем, что NASCAR остался, старый F1 удалён, добавлен новый.
	const want = "[\n  \"NASCAR_CUP_2026_1\",\n  \"F1_2026_2\"\n]"
	if string(got) != want {
		t.Fatalf("live.json = %s, want %s", string(got), want)
	}
}

func TestReadLiveIDs_SupportsObjectAndArray(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "live.json")

	// Новый формат: объект с полем live_event_ids.
	if err := os.WriteFile(path, []byte(`{"live_event_ids":["E1","E2"]}`), 0o644); err != nil {
		t.Fatalf("write object live.json: %v", err)
	}
	ids := readLiveIDs(path)
	if len(ids) != 2 || ids[0] != "E1" || ids[1] != "E2" {
		t.Fatalf("readLiveIDs(object) = %#v, want [\"E1\",\"E2\"]", ids)
	}

	// Старый формат: просто массив строк.
	if err := os.WriteFile(path, []byte(`["X1","X2"]`), 0o644); err != nil {
		t.Fatalf("write array live.json: %v", err)
	}
	ids = readLiveIDs(path)
	if len(ids) != 2 || ids[0] != "X1" || ids[1] != "X2" {
		t.Fatalf("readLiveIDs(array) = %#v, want [\"X1\",\"X2\"]", ids)
	}
}

func TestSyncNASCAR_GracefulOnEmptyFeed(t *testing.T) {
	// Подменяем функции-fetch на заглушки.
	origFetchLive := fetchNASCARLiveFeedFunc
	origFetchRaces := fetchNASCARRacesFunc
	fetchNASCARLiveFeedFunc = func() (*nascarLiveFeed, error) {
		return nil, fmt.Errorf("network down")
	}
	fetchNASCARRacesFunc = func(seriesID, season int) ([]nascarRace, error) {
		return nil, fmt.Errorf("should not be called")
	}
	defer func() {
		fetchNASCARLiveFeedFunc = origFetchLive
		fetchNASCARRacesFunc = origFetchRaces
	}()

	dir := t.TempDir()
	livePath := filepath.Join(dir, "live.json")
	if err := os.WriteFile(livePath, []byte(`["F1_2026_1","NASCAR_CUP_2026_1"]`), 0o644); err != nil {
		t.Fatalf("write seed live.json: %v", err)
	}

	if err := SyncNASCAR(dir); err != nil {
		t.Fatalf("SyncNASCAR error: %v", err)
	}
	got, err := os.ReadFile(livePath)
	if err != nil {
		t.Fatalf("read live.json: %v", err)
	}
	// Ожидаем, что NASCAR-запись очищена, F1 остался.
	const want = "[\n  \"F1_2026_1\"\n]"
	if string(got) != want {
		t.Fatalf("live.json = %s, want %s", string(got), want)
	}
}

func TestSyncOpenF1_GracefulOnNoSessions(t *testing.T) {
	origFetch := fetchOpenF1SessionsLatestFunc
	fetchOpenF1SessionsLatestFunc = func() ([]openF1Session, error) {
		return nil, nil
	}
	defer func() { fetchOpenF1SessionsLatestFunc = origFetch }()

	dir := t.TempDir()
	livePath := filepath.Join(dir, "live.json")
	if err := os.WriteFile(livePath, []byte(`["F1_2026_1","NASCAR_CUP_2026_1"]`), 0o644); err != nil {
		t.Fatalf("write seed live.json: %v", err)
	}

	if err := SyncOpenF1(dir); err != nil {
		t.Fatalf("SyncOpenF1 error: %v", err)
	}
	got, err := os.ReadFile(livePath)
	if err != nil {
		t.Fatalf("read live.json: %v", err)
	}
	// Ожидаем, что F1-запись очищена, NASCAR остался.
	const want = "[\n  \"NASCAR_CUP_2026_1\"\n]"
	if string(got) != want {
		t.Fatalf("live.json = %s, want %s", string(got), want)
	}
}

