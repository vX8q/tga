package schedulefile

import (
	"encoding/json"
	"fmt"
	"strings"
)

// RaceSession — одна гоночная сессия из event JSON (tables.race.sessions или tables.race с headers/rows).
// Один и тот же формат используется для F1, F2, F3, Supercars и др.
type RaceSession struct {
	Title   string     // "Sprint Race Results", "Race 4", ...
	Headers []string
	Rows    [][]string
}

// LoadEventEntryList возвращает карту номер машины -> полное имя пилота из entry_list события.
// Нужно для F2/F3: в таблицах результатов бывает "M. Shin" / "W. Shin" для одного пилота — по номеру машины подставляем каноническое имя.
func LoadEventEntryList(dataDir, eventID string) (map[string]string, error) {
	raw, err := readEventDetailFile(dataDir, eventID)
	if err != nil {
		return nil, err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	entryAny, ok := root["entry_list"]
	if !ok {
		return nil, nil
	}
	entrySlice, ok := entryAny.([]interface{})
	if !ok || len(entrySlice) == 0 {
		return nil, nil
	}
	out := make(map[string]string)
	for _, item := range entrySlice {
		obj, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		num := strings.TrimSpace(fmt.Sprint(obj["number"]))
		driver := strings.TrimSpace(fmt.Sprint(obj["driver"]))
		if num != "" && driver != "" {
			out[num] = driver
		}
	}
	return out, nil
}

// LoadEventRaceSessions читает event JSON и возвращает сессии из tables.race.sessions (или одну таблицу tables.race).
// Используется для импорта в БД и для сборки standings; один формат для F1/F2/F3/Supercars.
func LoadEventRaceSessions(dataDir, eventID string) ([]RaceSession, error) {
	raw, err := readEventDetailFile(dataDir, eventID)
	if err != nil {
		return nil, err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	tables, ok := root["tables"].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	// F1 и др.: таблица результатов в tables.race или tables.race_results
	raceAny, ok := tables["race"]
	if !ok {
		raceAny, ok = tables["race_results"]
		if !ok {
			return nil, nil
		}
	}
	raceMap, ok := raceAny.(map[string]interface{})
	if !ok {
		return nil, nil
	}
	// Вариант 1: tables.race.sessions[] (F2, F3, Supercars)
	sessionsAny, hasSessions := raceMap["sessions"].([]interface{})
	if !hasSessions {
		// Вариант 2: одна таблица tables.race с headers/rows (F1 и др.)
		if h, ok1 := raceMap["headers"].([]interface{}); ok1 {
			if r, ok2 := raceMap["rows"].([]interface{}); ok2 {
				var headers []string
				for _, v := range h {
					headers = append(headers, strings.TrimSpace(fmt.Sprint(v)))
				}
				var rows [][]string
				for _, rAny := range r {
					rSlice, ok := rAny.([]interface{})
					if !ok {
						continue
					}
					row := make([]string, len(rSlice))
					for i := range rSlice {
						row[i] = strings.TrimSpace(fmt.Sprint(rSlice[i]))
					}
					rows = append(rows, row)
				}
				if len(headers) > 0 && len(rows) > 0 {
					title := strings.TrimSpace(fmt.Sprint(raceMap["title"]))
					if title == "" {
						title = "Race"
					}
					return []RaceSession{{Title: title, Headers: headers, Rows: rows}}, nil
				}
			}
		}
		return nil, nil
	}
	var out []RaceSession
	for _, sessAny := range sessionsAny {
		sessMap, ok := sessAny.(map[string]interface{})
		if !ok {
			continue
		}
		title := strings.TrimSpace(fmt.Sprint(sessMap["title"]))
		headersAny, ok := sessMap["headers"].([]interface{})
		if !ok {
			continue
		}
		var headers []string
		for _, h := range headersAny {
			headers = append(headers, strings.TrimSpace(fmt.Sprint(h)))
		}
		rowsAny, ok := sessMap["rows"].([]interface{})
		if !ok {
			continue
		}
		var rows [][]string
		for _, rAny := range rowsAny {
			rSlice, ok := rAny.([]interface{})
			if !ok {
				continue
			}
			row := make([]string, len(rSlice))
			for i := range rSlice {
				row[i] = strings.TrimSpace(fmt.Sprint(rSlice[i]))
			}
			rows = append(rows, row)
		}
		out = append(out, RaceSession{Title: title, Headers: headers, Rows: rows})
	}
	return out, nil
}

// LoadSupercarsStartingGridByRace читает tables.starting_lineup.sessions из event JSON.
// Возвращает для каждой гонки (race_no 1..7) карту: канонический номер машины -> стартовая позиция (Pos).
// Нужно для заполнения results.grid_position при импорте и для Avg. Start в статистике.
func LoadSupercarsStartingGridByRace(dataDir, eventID string) (map[int]map[string]int, error) {
	raw, err := readEventDetailFile(dataDir, eventID)
	if err != nil {
		return nil, err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, err
	}
	tables, ok := root["tables"].(map[string]interface{})
	if !ok {
		return nil, nil
	}
	slAny, ok := tables["starting_lineup"]
	if !ok {
		return nil, nil
	}
	slMap, ok := slAny.(map[string]interface{})
	if !ok {
		return nil, nil
	}
	sessList, ok := slMap["sessions"].([]interface{})
	if !ok || len(sessList) == 0 {
		return nil, nil
	}
	out := make(map[int]map[string]int)
	for idx, sessAny := range sessList {
		sessMap, ok := sessAny.(map[string]interface{})
		if !ok {
			continue
		}
		raceNo := idx + 1
		if meta, ok := sessMap["meta"].(map[string]interface{}); ok {
			if rn, ok := meta["race_no"]; ok {
				switch v := rn.(type) {
				case float64:
					raceNo = int(v)
				case int:
					raceNo = v
				}
			}
		}
		headersAny, ok := sessMap["headers"].([]interface{})
		if !ok {
			continue
		}
		var headers []string
		for _, h := range headersAny {
			headers = append(headers, strings.TrimSpace(fmt.Sprint(h)))
		}
		rowsAny, ok := sessMap["rows"].([]interface{})
		if !ok {
			continue
		}
		colPos := firstColIndex(headers, "Pos", "Fin")
		colNo := firstColIndex(headers, "No", "No.", "#", "Car")
		if colPos < 0 || colNo < 0 {
			continue
		}
		byCar := make(map[string]int)
		for _, rAny := range rowsAny {
			rSlice, ok := rAny.([]interface{})
			if !ok {
				continue
			}
			row := make([]string, len(rSlice))
			for i := range rSlice {
				row[i] = strings.TrimSpace(fmt.Sprint(rSlice[i]))
			}
			pos := atoiSafe(valueAt(row, colPos))
			if pos <= 0 {
				continue
			}
			car := SupercarsCarToCanonical(valueAt(row, colNo))
			if car == "" {
				continue
			}
			byCar[car] = pos
		}
		if len(byCar) > 0 {
			out[raceNo] = byCar
		}
	}
	return out, nil
}
