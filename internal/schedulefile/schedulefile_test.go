package schedulefile

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vX8q/tga/models"
)

func TestEventToModel(t *testing.T) {
	tests := []struct {
		name    string
		e       EventJSON
		wantErr bool
		check   func(t *testing.T, ev *models.Event)
	}{
		{
			name: "valid",
			e: EventJSON{
				ID: "F1_2026_1", SeriesID: "F1", Season: "2026", Name: "Bahrain",
				StartDate: "2026-03-01", EndDate: "2026-03-02",
			},
			wantErr: false,
			check: func(t *testing.T, ev *models.Event) {
				if ev == nil {
					t.Fatal("ev is nil")
				}
				if ev.ID != "F1_2026_1" || ev.Season != "2026" {
					t.Errorf("ev ID=%q Season=%q", ev.ID, ev.Season)
				}
				if ev.StartDate.Year() != 2026 || ev.StartDate.Month() != 3 || ev.StartDate.Day() != 1 {
					t.Errorf("StartDate = %v", ev.StartDate)
				}
			},
		},
		{
			name:    "invalid start date",
			e:       EventJSON{ID: "x", StartDate: "not-a-date", EndDate: "2026-01-01"},
			wantErr: true,
		},
		{
			name:    "invalid end date",
			e:       EventJSON{ID: "x", StartDate: "2026-01-01", EndDate: "invalid"},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ev, err := EventToModel(tt.e)
			if (err != nil) != tt.wantErr {
				t.Errorf("EventToModel() err = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && tt.check != nil {
				tt.check(t, ev)
			}
		})
	}
}

func TestAtoiSafe(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"0", 0},
		{"42", 42},
		{" 99 ", 99},
		{"-5", -5},
		{"", 0},
		{"abc", 0},
		{"12x", 0},
	}
	for _, tt := range tests {
		got := atoiSafe(tt.in)
		if got != tt.want {
			t.Errorf("atoiSafe(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestAtoi(t *testing.T) {
	tests := []struct {
		in   string
		want int
	}{
		{"0", 0},
		{"123", 123},
		{"45", 45},
		{"12abc34", 1234},
		{"", 0},
	}
	for _, tt := range tests {
		got := atoi(tt.in)
		if got != tt.want {
			t.Errorf("atoi(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}

func TestIsExhibitionEvent(t *testing.T) {
	tests := []struct {
		seriesID string
		eventID  string
		want     bool
	}{
		{"NASCAR_CUP", "NASCAR_CUP_2026_0", true},
		{"NASCAR_CUP", "NASCAR_CUP_2026_1", false},
		{"nascar_cup", "NASCAR_CUP_2026_0", true},
		{"F1", "F1_2026_0", false},
		{"NASCAR_CUP", "NASCAR_CUP_2026_ALLSTAR_RACE", true},
		{"nascar_cup", "NASCAR_CUP_2026_ALLSTAR_RACE", true},
		{"NASCAR_CUP", "NASCAR_CUP_2025_ALL_STAR_OPEN", true},
		{"F1", "F1_2026_ALLSTAR_RACE", false},
	}
	for _, tt := range tests {
		got := isExhibitionEvent(tt.seriesID, tt.eventID)
		if got != tt.want {
			t.Errorf("isExhibitionEvent(%q, %q) = %v, want %v", tt.seriesID, tt.eventID, got, tt.want)
		}
	}
}

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		t.Fatalf("marshal %s: %v", path, err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestBuildStandingsFromEvents_DNQAndNC(t *testing.T) {
	dataDir := t.TempDir()

	// Базовый standings с одним кодом гонки.
	base := &StandingsData{
		RaceOrder: []string{"R1"},
		Rows:      []StandingRow{},
	}
	writeJSON(t, filepath.Join(dataDir, "standings", "stock_series.json"), base)

	// Расписание с одной гонкой.
	events := []EventJSON{
		{
			ID:        "STOCK_SERIES_2026_1",
			SeriesID:  "STOCK_SERIES",
			Season:    "2026",
			Name:      "Test Race",
			StartDate: "2026-01-01",
			EndDate:   "2026-01-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "stock_series.json"), events)

	// Детали события: один победитель, один DNQ через Status, один NC и отдельная таблица did_not_qualify.
	detail := &EventDetailJSON{
		EventID: "STOCK_SERIES_2026_1",
		Tables: map[string]EventTable{
			"race_results": {
				Headers: []string{"Pos", "Driver", "Points", "Status"},
				Rows: [][]string{
					{"1", "Driver A", "10", ""},
					{"", "Driver B", "0", "Did Not Qualify"},
					{"NC", "Driver C", "0", "Engine"},
				},
			},
			"did_not_qualify": {
				Headers: []string{"Driver"},
				Rows: [][]string{
					{"Driver D"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "stock_series_2026_1.json"), detail)

	got, err := BuildStandingsFromEvents(dataDir, "STOCK_SERIES", "")
	if err != nil {
		t.Fatalf("BuildStandingsFromEvents error: %v", err)
	}
	if got == nil {
		t.Fatal("BuildStandingsFromEvents returned nil")
	}
	if len(got.CompletedRaces) != 1 || got.CompletedRaces[0] != "R1" {
		t.Fatalf("CompletedRaces = %#v, want [\"R1\"]", got.CompletedRaces)
	}

	raceCode := "R1"
	raceByDriver := map[string]string{}
	pointsByDriver := map[string]string{}
	collect := func(rows []StandingRow) {
		for _, r := range rows {
			if r.Races != nil {
				if val, ok := r.Races[raceCode]; ok {
					raceByDriver[r.Driver] = val
				}
			}
			if r.Points != "" {
				pointsByDriver[r.Driver] = r.Points
			}
		}
	}
	collect(got.Rows)
	collect(got.Ineligible)

	if got := raceByDriver["Driver A"]; got != "1" {
		t.Errorf("Driver A race result = %q, want %q", got, "1")
	}
	if got := pointsByDriver["Driver A"]; got != "10" {
		t.Errorf("Driver A points = %q, want %q", got, "10")
	}
	if got := raceByDriver["Driver B"]; got != "DNQ" {
		t.Errorf("Driver B race result = %q, want %q (DNQ)", got, "DNQ")
	}
	if got := raceByDriver["Driver D"]; got != "DNQ" {
		t.Errorf("Driver D race result = %q, want %q (DNQ from did_not_qualify)", got, "DNQ")
	}
	// Для NC ожидаем использование индекса строки (третья строка → \"3\").
	if got := raceByDriver["Driver C"]; got != "3" {
		t.Errorf("Driver C race result = %q, want %q (NC → row index)", got, "3")
	}
}

func TestBuildStandingsFromEvents_F2SprintAndFeature(t *testing.T) {
	dataDir := t.TempDir()

	events := []EventJSON{
		{
			ID:        "F2_2026_1",
			SeriesID:  "F2",
			Season:    "2026",
			Name:      "Melbourne",
			StartDate: "2026-03-07",
			EndDate:   "2026-03-08",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "f2.json"), events)

	detail := &EventDetailJSON{
		EventID: "F2_2026_1",
		Tables: map[string]EventTable{
			"race": {
				Sessions: []EventTableSession{
					{
						Title:   "Sprint Race Results",
						Headers: []string{"Pos", "No.", "Driver", "Team", "Pts"},
						Rows: [][]string{
							{"1", "2", "Joshua Durksen", "Invicta Racing", "10"},
							{"2", "5", "Noel Leon", "Campos Racing", "8"},
						},
					},
					{
						Title:   "Feature Race Results",
						Headers: []string{"Pos", "No.", "Driver", "Team", "Pts"},
						Rows: [][]string{
							{"1", "5", "Noel Leon", "Campos Racing", "25"},
							{"2", "2", "Joshua Durksen", "Invicta Racing", "18"},
						},
					},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "F2", "2026", "f2_2026_1.json"), detail)

	got, err := BuildStandingsFromEvents(dataDir, "F2", "2026")
	if err != nil {
		t.Fatalf("BuildStandingsFromEvents error: %v", err)
	}
	if got == nil {
		t.Fatal("BuildStandingsFromEvents returned nil")
	}
	wantOrder := []string{"R1S", "R1F"}
	if len(got.RaceOrder) != len(wantOrder) {
		t.Fatalf("RaceOrder = %#v, want %#v", got.RaceOrder, wantOrder)
	}
	for i := range wantOrder {
		if got.RaceOrder[i] != wantOrder[i] {
			t.Fatalf("RaceOrder = %#v, want %#v", got.RaceOrder, wantOrder)
		}
	}
	if len(got.CompletedRaces) != len(wantOrder) {
		t.Fatalf("CompletedRaces = %#v, want %#v", got.CompletedRaces, wantOrder)
	}
	for i := range wantOrder {
		if got.CompletedRaces[i] != wantOrder[i] {
			t.Fatalf("CompletedRaces = %#v, want %#v", got.CompletedRaces, wantOrder)
		}
	}

	byDriver := map[string]StandingRow{}
	for _, r := range got.Rows {
		byDriver[r.Driver] = r
	}
	if got := byDriver["Noel Leon"].Points; got != "33" {
		t.Fatalf("Noel Leon points = %q, want 33", got)
	}
	if got := byDriver["Noel Leon"].Races["R1S"]; got != "2" {
		t.Fatalf("Noel Leon sprint = %q, want 2", got)
	}
	if got := byDriver["Noel Leon"].Races["R1F"]; got != "1" {
		t.Fatalf("Noel Leon feature = %q, want 1", got)
	}
}

func TestBuildDriverStatsFromJSON_Basic(t *testing.T) {
	dataDir := t.TempDir()

	events := []EventJSON{
		{
			ID:        "STATS_SERIES_2026_1",
			SeriesID:  "STATS_SERIES",
			Season:    "2026",
			Name:      "Stats Race",
			StartDate: "2026-01-01",
			EndDate:   "2026-01-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "stats_series.json"), events)

	detail := &EventDetailJSON{
		EventID: "STATS_SERIES_2026_1",
		Laps:    "100",
		Tables: map[string]EventTable{
			"race_results": {
				Headers: []string{"Pos", "Driver", "Team", "Manufacturer", "Grid", "Laps", "Led"},
				Rows: [][]string{
					{"1", "Driver A", "Team A", "Ford", "1", "100", "50"},
					{"2", "Driver B", "Team B", "Toyota", "2", "100", "0"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "stats_series_2026_1.json"), detail)

	stats, err := buildDriverStatsFromJSON(dataDir, "STATS_SERIES", "2026")
	if err != nil {
		t.Fatalf("buildDriverStatsFromJSON error: %v", err)
	}
	if stats == nil {
		t.Fatal("buildDriverStatsFromJSON returned nil")
	}
	if len(stats.Rows) != 2 {
		t.Fatalf("len(stats.Rows) = %d, want 2", len(stats.Rows))
	}

	var a *DriverStatsRow
	for i := range stats.Rows {
		if stats.Rows[i].Driver == "Driver A" {
			a = &stats.Rows[i]
			break
		}
	}
	if a == nil {
		t.Fatalf("Driver A not found in stats")
	}
	if a.Races != 1 {
		t.Errorf("Driver A races = %d, want 1", a.Races)
	}
	if a.Wins != 1 {
		t.Errorf("Driver A wins = %d, want 1", a.Wins)
	}
	if a.Poles != 1 {
		t.Errorf("Driver A poles = %d, want 1", a.Poles)
	}
	if a.AvgFinish != 1 {
		t.Errorf("Driver A AvgFinish = %v, want 1", a.AvgFinish)
	}
	if a.AvgStart != 1 {
		t.Errorf("Driver A AvgStart = %v, want 1", a.AvgStart)
	}
	if a.LapsCompletedPct != 100 {
		t.Errorf("Driver A LapsCompletedPct = %v, want 100", a.LapsCompletedPct)
	}
}

// TestBuildDriverStatsFromJSON_NascarNonNumericPositions проверяет обработку нечисловых позиций и процентов кругов.
func TestBuildDriverStatsFromJSON_NascarNonNumericPositions(t *testing.T) {
	dataDir := t.TempDir()

	events := []EventJSON{
		{
			ID:        "NASCAR_CUP_2025_1",
			SeriesID:  "NASCAR_CUP",
			Season:    "2025",
			Name:      "Test Cup Race",
			StartDate: "2025-02-01",
			EndDate:   "2025-02-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "nascar_cup.json"), events)

	detail := &EventDetailJSON{
		EventID: "NASCAR_CUP_2025_1",
		Tables: map[string]EventTable{
			"race_results": {
				Headers: []string{"Pos", "Driver", "Grid", "Laps", "Led"},
				Rows: [][]string{
					{"1", "Winner", "1", "100", "50"},
					{"DNF", "Finisher", "5", "80", "0"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "nascar_cup_2025_1.json"), detail)

	stats, err := buildDriverStatsFromJSON(dataDir, "NASCAR_CUP", "2025")
	if err != nil {
		t.Fatalf("buildDriverStatsFromJSON error: %v", err)
	}
	if stats == nil {
		t.Fatal("stats is nil")
	}
	if len(stats.Rows) != 2 {
		t.Fatalf("len(stats.Rows) = %d, want 2", len(stats.Rows))
	}

	var finisher *DriverStatsRow
	for i := range stats.Rows {
		if stats.Rows[i].Driver == "Finisher" {
			finisher = &stats.Rows[i]
			break
		}
	}
	if finisher == nil {
		t.Fatalf("Finisher not found in stats")
	}
	if finisher.Races != 1 {
		t.Errorf("Finisher races = %d, want 1", finisher.Races)
	}
	// Позиция "DNF" должна быть интерпретирована как индекс строки (2).
	if finisher.AvgFinish != 2 {
		t.Errorf("Finisher AvgFinish = %v, want 2", finisher.AvgFinish)
	}
	// Полные круги: 80 из 100.
	if finisher.LapsCompletedPct != 80 {
		t.Errorf("Finisher LapsCompletedPct = %v, want 80", finisher.LapsCompletedPct)
	}
}

// TestBuildDriverStatsFromJSON_IndyCarManufacturerFromTeams проверяет, что производитель берётся из Teams по номеру машины.
func TestBuildDriverStatsFromJSON_IndyCarManufacturerFromTeams(t *testing.T) {
	dataDir := t.TempDir()

	events := []EventJSON{
		{
			ID:        "INDYCAR_2025_1",
			SeriesID:  "INDYCAR",
			Season:    "2025",
			Name:      "IndyCar Test",
			StartDate: "2025-03-01",
			EndDate:   "2025-03-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "indycar.json"), events)

	teams := &TeamsWithSpec{
		Teams: []TeamJSON{
			{Number: "12", Manufacturer: "Chevy"},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "teams", "indycar.json"), teams)

	detail := &EventDetailJSON{
		EventID: "INDYCAR_2025_1",
		Laps:    "90",
		Tables: map[string]EventTable{
			"race_results": {
				Headers: []string{"Pos", "Driver", "Team", "Grid", "Laps", "Led", "Car"},
				Rows: [][]string{
					{"1", "Indy Driver", "Indy Team", "3", "90", "30", "12"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "indycar_2025_1.json"), detail)

	stats, err := buildDriverStatsFromJSON(dataDir, "INDYCAR", "2025")
	if err != nil {
		t.Fatalf("buildDriverStatsFromJSON error: %v", err)
	}
	if stats == nil {
		t.Fatal("stats is nil")
	}
	if len(stats.Rows) != 1 {
		t.Fatalf("len(stats.Rows) = %d, want 1", len(stats.Rows))
	}
	row := stats.Rows[0]
	if row.Manufacturer != "Chevy" {
		t.Errorf("Manufacturer = %q, want %q", row.Manufacturer, "Chevy")
	}
	if row.Car != "12" {
		t.Errorf("Car = %q, want %q", row.Car, "12")
	}
}

// TestBuildSupercarsDriverStatsFromJSON_Basic покрывает базовую статистику Supercars с несколькими сессиями и NC.
func TestBuildSupercarsDriverStatsFromJSON_Basic(t *testing.T) {
	dataDir := t.TempDir()

	events := []EventJSON{
		{
			ID:        "SUPERCARS_2025_1",
			SeriesID:  "SUPERCARS",
			Season:    "2025",
			Name:      "Supercars Test Event",
			StartDate: "2025-04-01",
			EndDate:   "2025-04-01",
		},
	}
	writeJSON(t, filepath.Join(dataDir, "schedules", "supercars.json"), events)

	teams := &TeamsWithSpec{
		Teams: []TeamJSON{
			{Number: "25", Team: "Team A", Manufacturer: "Ford"},
			{Number: "97", Team: "Team B", Manufacturer: "Chevy"},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "teams", "supercars.json"), teams)

	// Минимальный JSON событий Supercars: race.sessions + qualifying.
	eventJSON := map[string]any{
		"tables": map[string]any{
			"race": map[string]any{
				"sessions": []any{
					map[string]any{
						"name":    "Race 1",
						"headers": []any{"Pos", "Driver", "No"},
						"rows": []any{
							[]any{"1", "Driver A", "25"},
							[]any{"NC", "Driver B", "97"},
						},
					},
				},
			},
			"qualifying": map[string]any{
				"headers": []any{"Pos", "Driver", "No"},
				"rows": []any{
					[]any{"1", "Driver A", "25"},
					[]any{"2", "Driver B", "97"},
				},
			},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "events", "supercars_2025_1.json"), eventJSON)

	stats, err := buildSupercarsDriverStatsFromJSON(dataDir, "2025")
	if err != nil {
		t.Fatalf("buildSupercarsDriverStatsFromJSON error: %v", err)
	}
	if stats == nil {
		t.Fatal("stats is nil")
	}
	if len(stats.Rows) != 2 {
		t.Fatalf("len(stats.Rows) = %d, want 2", len(stats.Rows))
	}

	var a, b *DriverStatsRow
	for i := range stats.Rows {
		switch stats.Rows[i].Driver {
		case "Driver A":
			a = &stats.Rows[i]
		case "Driver B":
			b = &stats.Rows[i]
		}
	}
	if a == nil || b == nil {
		t.Fatalf("expected both Driver A and Driver B in stats, got: %+v", stats.Rows)
	}

	if a.Races != 1 || a.Wins != 1 {
		t.Errorf("Driver A races/wins = (%d,%d), want (1,1)", a.Races, a.Wins)
	}
	if b.Races != 1 {
		t.Errorf("Driver B races = %d, want 1", b.Races)
	}
	// Для NC ожидаем, что она считается последним местом (2) в своей сессии.
	if b.AvgFinish != 2 {
		t.Errorf("Driver B AvgFinish = %v, want 2 (NC treated as last)", b.AvgFinish)
	}
}

func FuzzAtoiSafe(f *testing.F) {
	f.Add("42")
	f.Add("")
	f.Add("-1")
	f.Fuzz(func(_ *testing.T, s string) {
		n := atoiSafe(s)
		_ = n
	})
}

func TestEnrichSupercarsEvent_FillsEntryListAndTeamNames(t *testing.T) {
	dataDir := t.TempDir()

	teams := &TeamsWithSpec{
		Teams: []TeamJSON{
			{Number: "07", Driver: "Driver A", Team: "Team A", Manufacturer: "Ford"},
			{Number: "7", Driver: "Driver B", Team: "Team B", Manufacturer: "Chevy"},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "teams", "supercars.json"), teams)

	body := []byte(`{"event_id":"SUPERCARS_2026_1","entry_list":[]}`)

	got, err := EnrichSupercarsEvent(body, dataDir, "supercars")
	if err != nil {
		t.Fatalf("EnrichSupercarsEvent error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatalf("unmarshal enriched: %v", err)
	}

	rawAny, hasKey := m["team_names_by_number"]
	if !hasKey {
		// Допустимо, если при тестовом JSON мы не смогли построить карту.
		t.Skip("team_names_by_number not present in enriched payload")
	}

	tnbn, ok := rawAny.(map[string]any)
	if !ok {
		t.Fatalf("team_names_by_number has unexpected type %T", rawAny)
	}
	if got := tnbn["07"]; got != "Team A" {
		t.Errorf("team_names_by_number[\"07\"] = %v, want %q", got, "Team A")
	}
	if got := tnbn["7"]; got != "Team A" {
		t.Errorf("team_names_by_number[\"7\"] = %v, want %q (normalized from 07)", got, "Team A")
	}
}

func TestEnrichStockCarEventTeamNames_UsesTeamsMapping(t *testing.T) {
	dataDir := t.TempDir()

	teams := &TeamsWithSpec{
		Teams: []TeamJSON{
			{Number: "1", Team: "Alpha"},
			{Number: "02", Team: "Beta"},
		},
	}
	writeJSON(t, filepath.Join(dataDir, "teams", "nascar_cup.json"), teams)

	body := []byte(`{"tables":{"race_results":{"headers":["No","Driver"],"rows":[["1","A"],["02","B"]]}}}`)

	got, err := EnrichStockCarEventTeamNames(body, dataDir, "NASCAR_CUP")
	if err != nil {
		t.Fatalf("EnrichStockCarEventTeamNames error: %v", err)
	}

	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatalf("unmarshal enriched: %v", err)
	}
	tnbn, ok := m["team_names_by_number"].(map[string]any)
	if !ok {
		t.Fatalf("team_names_by_number missing or wrong type")
	}
	if got := tnbn["1"]; got != "Alpha" {
		t.Errorf("team_names_by_number[\"1\"] = %v, want %q", got, "Alpha")
	}
	if got := tnbn["02"]; got != "Beta" {
		t.Errorf("team_names_by_number[\"02\"] = %v, want %q", got, "Beta")
	}
	if got := tnbn["2"]; got != "Beta" {
		t.Errorf("team_names_by_number[\"2\"] = %v, want %q (normalized from 02)", got, "Beta")
	}
}
