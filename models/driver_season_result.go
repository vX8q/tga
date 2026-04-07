package models

// DriverSeasonResult — результат пилота в одной гонке за сезон (для вывода на странице пилота).
type DriverSeasonResult struct {
	SeriesID   string  `json:"series_id"`
	SeriesName string  `json:"series_name"`
	EventID    string  `json:"event_id"`
	EventName  string  `json:"event_name"`
	RaceName   string  `json:"race_name"`
	Position   int     `json:"position"`
	Points     float64 `json:"points"`
	Laps       int     `json:"laps"`
	Status     string  `json:"status,omitempty"`
	CarNumber  string  `json:"car_number,omitempty"`
}
