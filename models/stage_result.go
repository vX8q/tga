package models

// StageResult — результат пилота в конкретном стейдже гонки.
type StageResult struct {
	ID        string
	RaceID    string
	SeriesID  string
	Season    string
	StageNo   int
	DriverID  string
	TeamID    string
	CarNumber string
	Position  int
	Laps      int
	Status    string
	Points    int
}

