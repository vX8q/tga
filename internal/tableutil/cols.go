// Package tableutil provides table parsing helpers.
package tableutil

import "strings"

// ColIndex возвращает индекс колонки по имени заголовка (без учёта регистра).
func ColIndex(headers []string, name string) int {
	lower := strings.TrimSpace(strings.ToLower(name))
	for i, h := range headers {
		if strings.TrimSpace(strings.ToLower(h)) == lower {
			return i
		}
	}
	return -1
}

// FirstColIndex возвращает индекс первой колонки из списка имён (без учёта регистра).
func FirstColIndex(headers []string, names ...string) int {
	for _, name := range names {
		if i := ColIndex(headers, name); i >= 0 {
			return i
		}
	}
	return -1
}
