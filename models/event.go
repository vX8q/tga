package models

import "time"

// Event — гоночный уик-энд / этап (например, один круг календаря F1)
type Event struct {
	ID             string
	SeriesID       string
	Season         string
	Name           string    // название этапа (e.g. "Bahrain GP")
	Location       string    // страна/трасса
	CircuitName    string
	StartDate      time.Time
	EndDate        time.Time
	TimeEST        string    // время старта EST из Excel (e.g. "1:30 PM")
	TimeMSK        string    // время MSK (e.g. "2/15/26 21:30")
}
