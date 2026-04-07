package main

import (
	"regexp"
)

// eventSeriesIDRe допускает только буквы, цифры, подчёркивание и дефис (для eventID и seriesID из URL).
var eventSeriesIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ValidEventOrSeriesID возвращает true, если s подходит для eventID или seriesID (без path traversal и спецсимволов).
func ValidEventOrSeriesID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	return eventSeriesIDRe.MatchString(s)
}
