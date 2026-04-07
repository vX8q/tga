package config

import (
	"testing"
)

func TestDataSeriesID(t *testing.T) {
	tests := []struct {
		champID string
		want    string
	}{
		{"NASCAR_CUP", "nascar_cup"},
		{"nascar-cup", "nascar_cup"},
		{"NASCAR_XFinity", "noaps"},
		{"nascar_xfinity", "noaps"},
		{"F1", "f1"},
		{"f1-2025", "f1"},
		{"", ""},
	}
	for _, tt := range tests {
		got := DataSeriesID(tt.champID)
		if got != tt.want {
			t.Errorf("DataSeriesID(%q) = %q, want %q", tt.champID, got, tt.want)
		}
	}
}
