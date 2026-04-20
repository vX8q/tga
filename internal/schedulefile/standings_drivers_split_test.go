package schedulefile

import (
	"reflect"
	"testing"
)

func TestSplitDriversCell(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"whitespace", "   ", nil},
		{"single", "Max Verstappen", []string{"Max Verstappen"}},
		{"semicolon super gt", "Sho Tsuboi; Kenta Yamashita", []string{"Sho Tsuboi", "Kenta Yamashita"}},
		{"slash wec", "Driver A / Driver B / Driver C", []string{"Driver A", "Driver B", "Driver C"}},
		{"comma", "A, B, C", []string{"A", "B", "C"}},
		{"mixed semicolon slash", "A / B; C / D", []string{"A", "B", "C", "D"}},
		{"duplicates collapsed", "A; A", []string{"A"}},
		{"padding trimmed", "  A  ;   B ", []string{"A", "B"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitDriversCell(tt.in)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("splitDriversCell(%q) = %#v, want %#v", tt.in, got, tt.want)
			}
		})
	}
}

func TestDriversFromRow(t *testing.T) {
	tests := []struct {
		name    string
		headers []string
		row     []string
		want    []string
	}{
		{
			name:    "single Driver column",
			headers: []string{"Pos", "Driver", "Pts"},
			row:     []string{"1", "Max Verstappen", "25"},
			want:    []string{"Max Verstappen"},
		},
		{
			name:    "plural Drivers column split",
			headers: []string{"Pos", "Drivers", "Pts"},
			row:     []string{"1", "Sho Tsuboi; Kenta Yamashita", "20"},
			want:    []string{"Sho Tsuboi", "Kenta Yamashita"},
		},
		{
			name:    "neither column",
			headers: []string{"Pos", "Team", "Pts"},
			row:     []string{"1", "Alpine", "25"},
			want:    nil,
		},
		{
			name:    "Driver column preferred over Drivers",
			headers: []string{"Driver", "Drivers"},
			row:     []string{"Primary", "Extra; Other"},
			want:    []string{"Primary"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := driversFromRow(tt.headers, tt.row)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("driversFromRow(%v, %v) = %#v, want %#v", tt.headers, tt.row, got, tt.want)
			}
		})
	}
}

func TestPointsColIndex(t *testing.T) {
	tests := []struct {
		name    string
		headers []string
		want    int
	}{
		{"Points", []string{"Pos", "Driver", "Points"}, 2},
		{"Pts", []string{"Pos", "Driver", "Pts"}, 2},
		{"Pts.", []string{"Pos", "Driver", "Pts."}, 2},
		{"DP (Super GT)", []string{"Pos", "Drivers", "DP", "TP"}, 2},
		{"none", []string{"Pos", "Driver"}, -1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pointsColIndex(tt.headers)
			if got != tt.want {
				t.Errorf("pointsColIndex(%v) = %d, want %d", tt.headers, got, tt.want)
			}
		})
	}
}
