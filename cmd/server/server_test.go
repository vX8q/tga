package main

import (
	"testing"
	"time"
)

func TestIsEventSoon(t *testing.T) {
	today := time.Now().Truncate(24 * time.Hour)
	todayStr := today.Format("2006-01-02")
	tomorrowStr := today.AddDate(0, 0, 1).Format("2006-01-02")
	in3DaysStr := today.AddDate(0, 0, 3).Format("2006-01-02")
	in8DaysStr := today.AddDate(0, 0, 8).Format("2006-01-02")
	yesterdayStr := today.AddDate(0, 0, -1).Format("2006-01-02")

	tests := []struct {
		name      string
		startDate string
		want      bool
	}{
		{"empty", "", false},
		{"invalid", "not-a-date", false},
		{"today", todayStr, true},
		{"tomorrow", tomorrowStr, true},
		{"in 3 days", in3DaysStr, true},
		{"in 8 days", in8DaysStr, false},
		{"yesterday", yesterdayStr, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isEventSoon(tt.startDate)
			if got != tt.want {
				t.Errorf("isEventSoon(%q) = %v, want %v", tt.startDate, got, tt.want)
			}
		})
	}
}
