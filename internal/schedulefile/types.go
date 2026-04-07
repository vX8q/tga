package schedulefile

import (
	"fmt"
	"strings"
	"time"

	"github.com/vX8q/tga/models"
)

// EventJSON — событие для сохранения в JSON (даты как строки YYYY-MM-DD)
type EventJSON struct {
	ID          string `json:"id"`
	SeriesID    string `json:"series_id"`
	Season      string `json:"season"`
	Name        string `json:"name"`
	Location    string `json:"location"`
	CircuitName string `json:"circuit_name"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
	TimeEST     string `json:"time_est"`
	TimeMSK     string `json:"time_msk"`
}

const dateFormat = "2006-01-02"

// EventToModel конвертирует EventJSON в models.Event (единая точка парсинга дат).
// Пустые start_date/end_date дают нулевую дату (time.Time{}). Невалидный формат даты возвращает ошибку.
func EventToModel(e EventJSON) (*models.Event, error) {
	var start, end time.Time
	if s := strings.TrimSpace(e.StartDate); s != "" {
		t, err := time.Parse(dateFormat, s)
		if err != nil {
			return nil, fmt.Errorf("parse start_date %q for event %q: %w", e.StartDate, e.ID, err)
		}
		start = t
	}
	if s := strings.TrimSpace(e.EndDate); s != "" {
		t, err := time.Parse(dateFormat, s)
		if err != nil {
			return nil, fmt.Errorf("parse end_date %q for event %q: %w", e.EndDate, e.ID, err)
		}
		end = t
	}
	return &models.Event{
		ID:          e.ID,
		SeriesID:    e.SeriesID,
		Season:      e.Season,
		Name:        e.Name,
		Location:    e.Location,
		CircuitName: e.CircuitName,
		StartDate:   start,
		EndDate:     end,
		TimeEST:     e.TimeEST,
		TimeMSK:     e.TimeMSK,
	}, nil
}

// TeamJSON — команда из листа Teams / кастомных файлов (например, IMSA)
type TeamJSON struct {
	Manufacturer string   `json:"manufacturer"`           // для NASCAR‑серий; для IndyCar — Engine (Chevrolet/Honda)
	Team         string   `json:"team"`
	Number       string   `json:"number"`
	Driver       string   `json:"driver"`                 // одиночный пилот (старый формат)
	CrewChief    string   `json:"crew_chief,omitempty"`
	FullTime     bool     `json:"full_time"`              // true = Full-time, false = Part-time (must be present for split tables)
	Races        string   `json:"races,omitempty"`        // optional, e.g. for part-time "1"

	// IndyCar: страна пилота и признак новичка для отображения "Country Name R"
	DriverCountry string `json:"driver_country,omitempty"`
	Rookie        bool   `json:"rookie,omitempty"`

	// IMSA / кастомные поля
	Class   string   `json:"class,omitempty"`             // GTP / LMP2 / GTD Pro / GTD
	Chassis string   `json:"chassis,omitempty"`           // шасси (Porsche 963, Oreca 07, ...)
	Drivers []string `json:"drivers,omitempty"`           // список пилотов
	Rounds  string   `json:"rounds,omitempty"`            // программа этапов (All, "7", "Rolex 24" и т.д.)

	// F1: силовая установка (Engine)
	PowerUnit string `json:"power_unit,omitempty"`
}

// CarModel — модель авто (Manufacturer + Model; для Truck — TruckBrand)
type CarModel struct {
	Manufacturer string `json:"manufacturer"`
	TruckBrand   string `json:"truck_brand,omitempty"` // для Truck: "Chevrolet Silverado" и т.д.
	Model        string `json:"model"`
}

// SpecRow — строка технической спецификации (ключ — значение)
type SpecRow struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// TeamsWithSpec — команды + модели авто + техническая спецификация
type TeamsWithSpec struct {
	Teams             []TeamJSON `json:"teams"`
	TeamsNonChartered []TeamJSON `json:"teams_non_chartered,omitempty"` // для Cup: команды без чартера
	CarModels         []CarModel `json:"car_models,omitempty"`
	TechnicalSpec     []SpecRow  `json:"technical_spec,omitempty"`
}

// StandingRow — строка турнирной таблицы (Pos, Driver, Team, Manufacturer/Car, Pts, Stages + по гонкам)
type StandingRow struct {
	Pos          int               `json:"pos"`
	Car          string            `json:"car,omitempty"`   // номер автомобиля
	Driver       string            `json:"driver"`
	Team         string            `json:"team"`
	Manufacturer string            `json:"manufacturer"`
	Points       string            `json:"points"`
	Stages       string            `json:"stages,omitempty"`
	Wth          string            `json:"wth,omitempty"`    // снятия/сходы
	Status       string            `json:"status,omitempty"` // e.g. DNQ, Wth
	Races        map[string]string `json:"races,omitempty"`  // код гонки -> место
}

// StandingsClass — отдельная таблица standings по классу (например, GTP/LMP2/GTD Pro/GTD для IMSA).
type StandingsClass struct {
	ID   string        `json:"id"`
	Name string        `json:"name"`
	Rows []StandingRow `json:"rows"`
}

// StandingsData — турнирная таблица с порядком колонок гонок (DAY, ATL, ...) и, опционально,
// отдельными таблицами по классам (IMSA и др.).
// EventNames — названия этапов в том же порядке, что и RaceOrder (для F1/F2/F3 — верхняя строка заголовков).
type StandingsData struct {
	RaceOrder      []string         `json:"race_order,omitempty"`
	EventNames     []string         `json:"event_names,omitempty"` // название этапа для каждой гонки (len = len(RaceOrder))
	CompletedRaces []string         `json:"completed_races,omitempty"`
	Rows           []StandingRow    `json:"rows"`
	Ineligible     []StandingRow    `json:"ineligible,omitempty"`
	Classes        []StandingsClass `json:"classes,omitempty"`
}

// EventDetailJSON — детали гонки: инфо, entry list, практики, квалификация, дуэли, результаты и т.д.
type EventDetailJSON struct {
	EventID        string              `json:"event_id"`
	Series         string              `json:"series,omitempty"`
	Race           string              `json:"race,omitempty"`
	Date           string              `json:"date,omitempty"`
	Track          string              `json:"track,omitempty"`
	Location       string              `json:"location,omitempty"`
	Laps           string              `json:"laps,omitempty"`
	Distance       string              `json:"distance,omitempty"`
	EntryList      []EntryListRow      `json:"entry_list,omitempty"`
	Tables         map[string]EventTable `json:"tables,omitempty"` // practice, qualifying, duel1, duel2, starting_lineup, practice2, final_practice, stage1, stage2, race_results, caution_breakdown
	RaceStatistics map[string]string   `json:"race_statistics,omitempty"`
	TrackInfo      string              `json:"track_info,omitempty"`
	TrackInfoRu    string              `json:"track_info_ru,omitempty"`
	YoutubeID      string              `json:"youtube_id,omitempty"`
}

// EventTable — таблица с заголовками и строками (универсальный формат для Practice, Qualifying и т.д.)
type EventTable struct {
	Headers  []string             `json:"headers"`
	Rows     [][]string           `json:"rows"`
	Sessions []EventTableSession  `json:"sessions,omitempty"`
}

// EventTableSession — сессия внутри таблицы (часто встречается в event JSON: practice/qualifying/race.sessions).
type EventTableSession struct {
	Title   string     `json:"title,omitempty"`
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

// EntryListRow — строка entry list (No, Driver, Team, Manufacturer, Crew Chief для Stock-car)
type EntryListRow struct {
	Number       string `json:"number"`
	Driver       string `json:"driver"`
	Team         string `json:"team"`
	Manufacturer string `json:"manufacturer"`
	CrewChief    string `json:"crew_chief,omitempty"`
}

