package models

// Result — результат участника в гонке
type Result struct {
	ID          string
	RaceID      string
	DriverID    string
	TeamID      string
	CarNumber   string
	Position    int       // финишная позиция (1-based)
	GridPosition int      // стартовая позиция
	Laps        int       // пройденные круги
	LapsLed     int       // круги в лидерах
	Status      string    // "finished", "DNF", "DSQ", ...
	Points      float64
	FastestLap  string    // время быстрого круга (если есть)
}
