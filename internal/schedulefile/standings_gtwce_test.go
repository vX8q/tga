package schedulefile

import (
	"path/filepath"
	"testing"
)

func TestBuildGtwceStandingsFromEvents_Sprint2026(t *testing.T) {
	dataDir, err := filepath.Abs(filepath.Join("..", "..", "data"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := BuildGtwceStandingsFromEvents(dataDir, "GTWCE_SPRINT", "2026")
	if err != nil {
		t.Fatal(err)
	}
	if data == nil {
		t.Fatal("nil data")
	}
	if len(data.Classes) != 4 {
		t.Fatalf("classes: want 4 got %d", len(data.Classes))
	}
	if len(data.RaceOrder) < 2 {
		t.Fatalf("race_order: want >=2 cols for sprint, got %d", len(data.RaceOrder))
	}
	var overallPts int
	for _, c := range data.Classes {
		if c.ID == "overall" {
			overallPts = len(c.Rows)
			break
		}
	}
	if overallPts == 0 {
		t.Fatal("expected Overall table with at least one row from gtwce sprint event data")
	}
	// Brands Hatch 2026: 34 машины в протоколе + объединение с entry_list (не меньше заявленных экипажей).
	if overallPts < 33 {
		t.Fatalf("overall standings: want >=33 rows (full grid / entry list), got %d — пересоберите сервер и сбросьте кэш API", overallPts)
	}
}

func TestBuildGtwceStandingsFromEvents_Endurance2026(t *testing.T) {
	dataDir, err := filepath.Abs(filepath.Join("..", "..", "data"))
	if err != nil {
		t.Fatal(err)
	}
	data, err := BuildGtwceStandingsFromEvents(dataDir, "GTWCE_END", "2026")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Classes) != 4 {
		t.Fatalf("classes: want 4 got %d", len(data.Classes))
	}
	if len(data.RaceOrder) < 1 {
		t.Fatal("expected at least one race column")
	}
}
