package config

import "strings"

// SeriesType — категория серии
type SeriesType string

const (
	OpenWheel      SeriesType = "openwheel"
	GTEndurance    SeriesType = "gt_endurance"
	GTSprint       SeriesType = "gt_sprint"
	Touring        SeriesType = "touring"
	StockCarRacing SeriesType = "stock_car_racing"
	SingleMake     SeriesType = "single_make"
)

// Championship — серия/чемпионат
type Championship struct {
	ID      string
	Name    string
	Season  string
	Type    SeriesType
	Country string
	Active  bool
}

// CurrentSeason — сезон по умолчанию
const CurrentSeason = "2026"

// DataSeriesID возвращает идентификатор для каталога/файлов данных (например nascar_xfinity -> noaps).
// Для season-slug вида "f1-2025" возвращает "f1" (сезон извлекается отдельно).
func DataSeriesID(champID string) string {
	s := strings.ToLower(champID)
	// f1-2025 -> f1 (сезон в slug)
	if idx := strings.LastIndex(s, "-"); idx > 0 && idx+5 == len(s) {
		if year := s[idx+1:]; len(year) == 4 && year >= "2000" && year <= "2099" {
			return strings.ReplaceAll(s[:idx], "-", "_")
		}
	}
	// URL-slug uses hyphens (e.g. nascar-cup), data files use underscores (nascar_cup).
	s = strings.ReplaceAll(s, "-", "_")
	if s == "nascar_xfinity" {
		return "noaps"
	}
	return s
}
