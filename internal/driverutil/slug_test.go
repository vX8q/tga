package driverutil

import (
	"testing"
)

func TestSlug(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"simple", "Lewis Hamilton", "lewis-hamilton"},
		{"lowercase", "MAX VERSTAPPEN", "max-verstappen"},
		{"cyrillic", "Даниил Квят", "даниил-квят"},
		{"numbers", "Driver 1", "driver-1"},
		{"multiple dashes", "  a   b  c  ", "a-b-c"},
		{"trim", "  x  ", "x"},
		{"special chars", "O'Brien Jr.", "o-brien-jr"},
		{"umlaut", "Nico Hülkenberg", "nico-hulkenberg"},
		{"accent", "Sergio Pérez", "sergio-perez"},
		{"cedilla", "François Cevert", "francois-cevert"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Slug(tt.in)
			if got != tt.want {
				t.Errorf("Slug(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeKey(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"simple", "Lewis Hamilton", "lewis_hamilton"},
		{"dash", "nascar-xfinity", "nascar_xfinity"},
		{"dots", "Jr.", "jr"},
		{"apostrophe", "O'Brien", "obrien"},
		{"trim", "  a b  ", "a_b"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NormalizeKey(tt.in)
			if got != tt.want {
				t.Errorf("NormalizeKey(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestMakeDriverID(t *testing.T) {
	tests := []struct {
		seriesID   string
		driverName string
		carNumber  string
		want       string
	}{
		{"F1", "Lewis Hamilton", "", "F1:DRIVER:lewis_hamilton"},
		{"NASCAR_CUP", "Chase Elliott", "9", "NASCAR_CUP:DRIVER:9:chase_elliott"},
		{"nascar_cup", "Kyle Busch", "8", "NASCAR_CUP:DRIVER:8:kyle_busch"},
	}
	for _, tt := range tests {
		got := MakeDriverID(tt.seriesID, tt.driverName, tt.carNumber)
		if got != tt.want {
			t.Errorf("MakeDriverID(%q, %q, %q) = %q, want %q",
				tt.seriesID, tt.driverName, tt.carNumber, got, tt.want)
		}
	}
}

func FuzzSlug(f *testing.F) {
	f.Add("Lewis Hamilton")
	f.Add("")
	f.Add("MAX VERSTAPPEN  ")
	f.Fuzz(func(t *testing.T, name string) {
		s := Slug(name)
		for _, c := range s {
			if c == ' ' {
				t.Errorf("Slug(%q) contains space: %q", name, s)
			}
		}
		if len(name) > 0 && len(s) > 0 && s[0] == '-' {
			t.Errorf("Slug(%q) starts with dash: %q", name, s)
		}
	})
}
