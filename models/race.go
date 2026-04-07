package models

import "time"

// Race — одна гонка (результаты, сетка, лидеры кругов)
type Race struct {
	ID          string
	EventID     string
	SeriesID    string
	Season      string
	Name        string    // "Race", "Sprint", "Feature", etc.
	ScheduleAt  time.Time
	Laps        int
	Distance    string    // e.g. "305 km"
	Status      string    // "scheduled", "completed", "cancelled"
}
