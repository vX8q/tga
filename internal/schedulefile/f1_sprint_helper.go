package schedulefile

import (
	"strings"
)

// eventHasSprintRaceSession возвращает true, если в tables.race.sessions события
// есть хотя бы одна сессия с результатами спринт‑гонки (заголовок содержит "sprint").
func eventHasSprintRaceSession(dataDir, eventID string) bool {
	sessions, err := LoadEventRaceSessions(dataDir, eventID)
	if err != nil || len(sessions) == 0 {
		return false
	}
	for _, s := range sessions {
		title := strings.ToLower(strings.TrimSpace(s.Title))
		if strings.Contains(title, "sprint") && len(s.Headers) > 0 && len(s.Rows) > 0 {
			return true
		}
	}
	return false
}

