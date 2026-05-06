// Package driverutil provides helpers for driver identifiers.
package driverutil

import (
	"regexp"
	"strings"
)

// SlugRe заменяет последовательности не-букв/цифр (латиница, кириллица, цифры) на один дефис.
var SlugRe = regexp.MustCompile(`[^a-z0-9\p{Cyrillic}]+`)

var diacritics = strings.NewReplacer(
	"ü", "u", "Ü", "u",
	"é", "e", "É", "e",
	"á", "a", "Á", "a",
	"í", "i", "Í", "i",
	"ó", "o", "Ó", "o",
	"ú", "u", "Ú", "u",
	"ñ", "n", "Ñ", "n",
	"ä", "a", "Ä", "a",
	"ö", "o", "Ö", "o",
	"ß", "ss",
	"ø", "o", "Ø", "o",
	"å", "a", "Å", "a",
	"æ", "ae", "Æ", "ae",
	"ç", "c", "Ç", "c",
	"è", "e", "È", "e",
	"ê", "e", "Ê", "e",
	"ë", "e", "Ë", "e",
	"ì", "i", "Ì", "i",
	"î", "i", "Î", "i",
	"ï", "i", "Ï", "i",
	"ò", "o", "Ò", "o",
	"ô", "o", "Ô", "o",
	"ù", "u", "Ù", "u",
	"û", "u", "Û", "u",
	"ý", "y", "Ý", "y",
	"ÿ", "y",
	"ž", "z", "Ž", "z",
	"š", "s", "Š", "s",
	"č", "c", "Č", "c",
	"ř", "r", "Ř", "r",
	"ď", "d", "Ď", "d",
	"ť", "t", "Ť", "t",
	"ň", "n", "Ň", "n",
	"ł", "l", "Ł", "l",
	"ą", "a", "Ą", "a",
	"ę", "e", "Ę", "e",
	"ś", "s", "Ś", "s",
	"ź", "z", "Ź", "z",
	"ż", "z", "Ż", "z",
	"ć", "c", "Ć", "c",
	"ő", "o", "Ő", "o",
	"ű", "u", "Ű", "u",
)

// Slug возвращает URL-слаг из имени (для совпадения с фронтом).
func Slug(name string) string {
	s := strings.TrimSpace(strings.ToLower(name))
	s = diacritics.Replace(s)
	s = SlugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// NormalizeKey нормализует строку для использования в ID (lowercase, пробелы/дефисы в подчёркивания, без точек и апострофов).
func NormalizeKey(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.ReplaceAll(s, " ", "_")
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, ".", "")
	s = strings.ReplaceAll(s, "'", "")
	return s
}

// MakeDriverID формирует ID пилота по серии, имени и опционально номеру авто.
func MakeDriverID(seriesID, driverName, carNumber string) string {
	base := NormalizeKey(driverName)
	if carNumber != "" {
		return strings.ToUpper(seriesID) + ":DRIVER:" + carNumber + ":" + base
	}
	return strings.ToUpper(seriesID) + ":DRIVER:" + base
}
