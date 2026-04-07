package schedulefile

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/vX8q/tga/config"
)

// EnrichSupercarsEvent обогащает JSON события Supercars: entry_list из Teams и team_names_by_number.
// Возвращает обновлённый body или исходный при ошибке/не Supercars.
func EnrichSupercarsEvent(body []byte, dataDir, seriesID string) ([]byte, error) {
	if strings.ToLower(seriesID) != "supercars" {
		return body, nil
	}
	teams, err := LoadTeams(dataDir, seriesID)
	if err != nil || teams == nil || len(teams.Teams) == 0 {
		return body, nil
	}
	var eventMap map[string]interface{}
	if err := json.Unmarshal(body, &eventMap); err != nil {
		return body, err
	}
	if entryListRaw := eventMap["entry_list"]; entryListRaw == nil {
		entryList := make([]map[string]interface{}, 0, len(teams.Teams))
		for _, t := range teams.Teams {
			entryList = append(entryList, map[string]interface{}{
				"number":       t.Number,
				"driver":       t.Driver,
				"team":         t.Team,
				"manufacturer": t.Manufacturer,
			})
		}
		eventMap["entry_list"] = entryList
	}
	byNumber := make(map[string]string)
	if entryListRaw, ok := eventMap["entry_list"]; ok && entryListRaw != nil {
		if list, ok := entryListRaw.([]interface{}); ok {
			for _, item := range list {
				m, ok := item.(map[string]interface{})
				if !ok {
					continue
				}
				numVal, _ := m["number"]
				teamVal, _ := m["team"].(string)
				if teamVal == "" {
					continue
				}
				var numStr string
				switch v := numVal.(type) {
				case string:
					numStr = strings.TrimSpace(v)
				case float64:
					numStr = strconv.Itoa(int(v))
				default:
					continue
				}
				if numStr == "" {
					continue
				}
				byNumber[numStr] = teamVal
				if n, err := strconv.Atoi(strings.TrimLeft(numStr, "0")); err == nil {
					byNumber[strconv.Itoa(n)] = teamVal
					if n >= 1 && n <= 9 {
						byNumber[fmt.Sprintf("%02d", n)] = teamVal
					}
				}
			}
		}
	}
	if len(byNumber) > 0 {
		eventMap["team_names_by_number"] = byNumber
	}
	return json.Marshal(eventMap)
}

var stockCarSeriesIDs = map[string]bool{
	"nascar_truck":   true,
	"nascar_cup":     true,
	"noaps":          true,
	"arca":           true,
	"nascar_modified": true,
}

// EnrichStockCarEventTeamNames подставляет team_names_by_number из файла Teams серии (для Entry list и таблиц).
// Названия команд в UI берутся из Teams, а не из entry_list события.
func EnrichStockCarEventTeamNames(body []byte, dataDir, seriesID string) ([]byte, error) {
	if seriesID == "" {
		return body, nil
	}
	s := strings.ToLower(seriesID)
	if !stockCarSeriesIDs[s] {
		return body, nil
	}
	dataSeriesID := config.DataSeriesID(seriesID)
	teams, err := LoadTeams(dataDir, dataSeriesID)
	if err != nil || teams == nil || len(teams.Teams) == 0 {
		return body, nil
	}
	byNumber := make(map[string]string)
	for _, t := range teams.Teams {
		numStr := strings.TrimSpace(t.Number)
		if numStr == "" {
			continue
		}
		teamVal := strings.TrimSpace(t.Team)
		if teamVal == "" {
			continue
		}
		byNumber[numStr] = teamVal
		if n, err := strconv.Atoi(strings.TrimLeft(numStr, "0")); err == nil {
			byNumber[strconv.Itoa(n)] = teamVal
			if n >= 1 && n <= 9 {
				byNumber[fmt.Sprintf("%02d", n)] = teamVal
			}
		}
	}
	if len(byNumber) == 0 {
		return body, nil
	}
	var eventMap map[string]interface{}
	if err := json.Unmarshal(body, &eventMap); err != nil {
		return body, err
	}
	eventMap["team_names_by_number"] = byNumber
	return json.Marshal(eventMap)
}

// isExhibitionEvent определяет, является ли событие выставочной гонкой,
// результаты которой не должны учитываться в турнирной таблице.
// Сейчас это используется для исключения Cook Out Clash из зачёта Cup Series.
func isExhibitionEvent(seriesID string, eventID string) bool {
	if !strings.EqualFold(seriesID, "NASCAR_CUP") {
		return false
	}
	parts := strings.Split(eventID, "_")
	if len(parts) == 0 {
		return false
	}
	last := parts[len(parts)-1]
	return last == "0"
}

