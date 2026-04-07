package schedulefile

import (
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/vX8q/tga/models"
)

func nullFloat64(v sql.NullFloat64) float64 {
	if v.Valid {
		return v.Float64
	}
	return 0
}

// SaveEvents сохраняет события в data/schedules/{seriesID}.json
func SaveEvents(dataDir string, seriesID string, events []models.Event) error {
	if len(events) == 0 {
		return nil
	}
	out := make([]EventJSON, len(events))
	for i, e := range events {
		out[i] = EventJSON{
			ID:          e.ID,
			SeriesID:    e.SeriesID,
			Season:      e.Season,
			Name:        e.Name,
			Location:    e.Location,
			CircuitName: e.CircuitName,
			StartDate:   e.StartDate.Format(dateFormat),
			EndDate:     e.EndDate.Format(dateFormat),
			TimeEST:     e.TimeEST,
			TimeMSK:     e.TimeMSK,
		}
	}
	return saveJSONFile(eventsPath(dataDir, seriesID), out)
}

// LoadEvents загружает события из data/schedules/{seriesID}.json
func LoadEvents(dataDir string, seriesID string) ([]EventJSON, error) {
	b, err := readFileIfExists(eventsPath(dataDir, seriesID))
	if err != nil || b == nil {
		return nil, err
	}
	var out []EventJSON
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// (типы команд и спецификаций вынесены в types.go)

func SaveTeams(dataDir string, seriesID string, data *TeamsWithSpec) error {
	if data == nil || (len(data.Teams) == 0 && len(data.CarModels) == 0 && len(data.TechnicalSpec) == 0) {
		return nil
	}
	// Обратная совместимость: если только teams без обёртки, сохраняем как раньше массив
	if len(data.CarModels) == 0 && len(data.TechnicalSpec) == 0 && len(data.TeamsNonChartered) == 0 {
		return saveJSONFile(teamsPath(dataDir, seriesID), data.Teams)
	}
	return saveJSONFile(teamsPath(dataDir, seriesID), data)
}

// LoadTeamsForSeason загружает команды; при указанном season пробует seriesID_season.json (например f1_2025).
// Для F1 при сезоне 2026, если f1_2026 отсутствует, используется базовый f1.json (данные 2026).
func LoadTeamsForSeason(dataDir string, seriesID string, season string) (*TeamsWithSpec, error) {
	if season != "" {
		seasonID := strings.ToLower(seriesID) + "_" + season
		if data, err := LoadTeams(dataDir, seasonID); err == nil && data != nil && len(data.Teams) > 0 {
			return data, nil
		}
		// F1 2026: файла f1_2026.json нет — используем базовый f1.json (актуальные команды 2026).
		if strings.EqualFold(seriesID, "f1") && season == "2026" {
			if data, err := LoadTeams(dataDir, "f1"); err == nil && data != nil && len(data.Teams) > 0 {
				return data, nil
			}
		}
	}
	return LoadTeams(dataDir, seriesID)
}

func LoadTeams(dataDir string, seriesID string) (*TeamsWithSpec, error) {
	b, err := readFileIfExists(teamsPath(dataDir, seriesID))
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return &TeamsWithSpec{}, nil
	}
	// Пробуем как объект { teams, car_models, technical_spec }
	var withSpec TeamsWithSpec
	if err := json.Unmarshal(b, &withSpec); err == nil && (len(withSpec.Teams) > 0 || len(withSpec.CarModels) > 0 || len(withSpec.TechnicalSpec) > 0) {
		return &withSpec, nil
	}
	// Иначе как массив команд (старый формат)
	var arr []TeamJSON
	if err := json.Unmarshal(b, &arr); err != nil {
		return &TeamsWithSpec{}, nil
	}
	return &TeamsWithSpec{Teams: arr}, nil
}

// (типы StandingRow и StandingsData вынесены в types.go)

type DriverStatsRow struct {
	Driver            string  `json:"driver"`
	Team              string  `json:"team"`
	Manufacturer      string  `json:"manufacturer"`
	Chassis           string  `json:"chassis,omitempty"` // шасси (F1 и др.)
	Car               string  `json:"car,omitempty"`
	Races             int     `json:"races"`
	Wins              int     `json:"wins"`
	Top2              int     `json:"top2,omitempty"`
	Top3              int     `json:"top3,omitempty"`
	Podiums           int     `json:"podiums,omitempty"` // wins + top2 + top3 (все финиши на подиуме)
	Poles             int     `json:"poles"`
	Top5              int     `json:"top5"`
	Top10             int     `json:"top10"`
	Top15             int     `json:"top15"`
	Top20             int     `json:"top20"`
	FastestLaps       int     `json:"fastest_laps,omitempty"`
	BestLap           string  `json:"best_lap,omitempty"` // лучший круг за сезон (как строка, из results.fastest_lap)
	AvgFinish         float64 `json:"avg_finish"`
	AvgStart          float64 `json:"avg_start"`
	AvgQualifying     float64 `json:"avg_qualifying,omitempty"` // средняя позиция в квалификации (F1)
	Q2Passes          int     `json:"q2_passes,omitempty"`      // проходы в Q2 (F1)
	Q3Passes          int     `json:"q3_passes,omitempty"`     // проходы в Q3 (F1)
	StageWins         int     `json:"stage_wins"`
	StagePoints       int     `json:"stage_points,omitempty"`
	AvgStagePoints    float64 `json:"avg_stage_points,omitempty"`
	LapsLed           int     `json:"laps_led"`
	LapsCompleted     int     `json:"laps_completed,omitempty"`
	LapsCompletedPct  float64 `json:"laps_completed_pct"`
	PositionDiff      float64 `json:"pos_diff"`
}

// ManufacturerStatsRow — агрегированная статистика по марке/производителю.
type ManufacturerStatsRow struct {
	Manufacturer string  `json:"manufacturer"`
	Races        int     `json:"races"`
	Wins         int     `json:"wins"`
	Top2         int     `json:"top2,omitempty"`
	Top3         int     `json:"top3,omitempty"`
	Podiums      int     `json:"podiums,omitempty"`
	Poles        int     `json:"poles,omitempty"`
	Top5         int     `json:"top5,omitempty"`
	Top10        int     `json:"top10,omitempty"`
	Top15        int     `json:"top15,omitempty"`
	Top20        int     `json:"top20,omitempty"`
	FastestLaps  int     `json:"fastest_laps,omitempty"`
	AvgFinish    float64 `json:"avg_finish"`
	AvgStart     float64 `json:"avg_start"`
	AvgQualifying float64 `json:"avg_qualifying,omitempty"`
	Q2Passes     int     `json:"q2_passes,omitempty"`
	Q3Passes     int     `json:"q3_passes,omitempty"`
	StageWins    int     `json:"stage_wins,omitempty"`
	StagePoints  int     `json:"stage_points,omitempty"`
	AvgStagePoints float64 `json:"avg_stage_points,omitempty"`
	LapsLed      int     `json:"laps_led"`
	LapsCompleted int    `json:"laps_completed,omitempty"`
	LapsCompletedPct float64 `json:"laps_completed_pct,omitempty"`
	PositionDiff float64 `json:"pos_diff,omitempty"`
}

// TeamStatsRow — агрегированная статистика по команде.
type TeamStatsRow struct {
	Team             string  `json:"team"`
	Races            int     `json:"races"`
	Wins             int     `json:"wins"`
	Poles            int     `json:"poles"`
	Top5             int     `json:"top5"`
	Top10            int     `json:"top10"`
	Top15            int     `json:"top15"`
	Top20            int     `json:"top20"`
	AvgFinish        float64 `json:"avg_finish"`
	AvgStart         float64 `json:"avg_start"`
	StageWins        int     `json:"stage_wins"`
	StagePoints      int     `json:"stage_points,omitempty"`
	AvgStagePoints   float64 `json:"avg_stage_points,omitempty"`
	LapsLed          int     `json:"laps_led"`
	LapsCompletedPct float64 `json:"laps_completed_pct"`
	PositionDiff     float64 `json:"pos_diff"`
}

// DriverStatsData — коллекция статистики пилотов, команд и производителей.
type DriverStatsData struct {
	Rows          []DriverStatsRow       `json:"rows"`
	Teams         []TeamStatsRow         `json:"teams,omitempty"`
	Manufacturers []ManufacturerStatsRow `json:"manufacturers,omitempty"`
}

func SaveStandings(dataDir string, seriesID string, data *StandingsData) error {
	if data == nil || len(data.Rows) == 0 {
		return nil
	}
	return saveJSONFile(standingsPath(dataDir, seriesID), data)
}

func LoadStandings(dataDir string, seriesID string) (*StandingsData, error) {
	b, err := readFileIfExists(standingsPath(dataDir, seriesID))
	if err != nil || b == nil {
		return nil, err
	}
	var out StandingsData
	if err := json.Unmarshal(b, &out); err != nil {
		// Старый формат: массив StandingRow
		var arr []StandingRow
		if err2 := json.Unmarshal(b, &arr); err2 != nil {
			return nil, err
		}
		return &StandingsData{Rows: arr}, nil
	}
	return &out, nil
}

// (типы EventDetailJSON/EventTable/EntryListRow вынесены в types.go)

func SaveEventDetail(dataDir string, eventID string, detail *EventDetailJSON) error {
	return saveJSONFile(eventDetailPath(dataDir, eventID), detail)
}

func LoadEventDetail(dataDir string, eventID string) (*EventDetailJSON, error) {
	b, err := readEventDetailFile(dataDir, strings.ToLower(eventID))
	if err != nil || b == nil {
		return nil, err
	}
	var out EventDetailJSON
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// BuildDriverStatsFromEvents сохраняет совместимость старого API и всегда использует JSON‑путь.
// Для серверных эндпоинтов с БД следует вызывать BuildDriverStatsFromDB с уже открытым *sql.DB.
func BuildDriverStatsFromEvents(dataDir string, seriesID string, season string) (*DriverStatsData, error) {
	return buildDriverStatsFromJSON(dataDir, seriesID, season)
}
