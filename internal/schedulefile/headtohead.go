package schedulefile

import (
	"strings"
)

// HeadToHeadEvent описывает сравнение двух пилотов в рамках одного события.
type HeadToHeadEvent struct {
	EventID string  `json:"event_id,omitempty"`
	Label   string  `json:"label"`
	PointsA float64 `json:"pointsA"`
	PointsB float64 `json:"pointsB"`
	QualiA  float64 `json:"qualiA"`
	QualiB  float64 `json:"qualiB"`
	FinishA float64 `json:"finishA"`
	FinishB float64 `json:"finishB"`
}

// HeadToHeadData — ответ для фронтенда: массив событий.
type HeadToHeadData struct {
	Events []HeadToHeadEvent `json:"events"`
}

// BuildHeadToHeadFromEvents строит head-to-head статистику по уик-эндам для двух пилотов
// на основе JSON-деталей гонок (race_results + stage1/2).
func BuildHeadToHeadFromEvents(dataDir, seriesID, season, driverA, driverB string) (*HeadToHeadData, error) {
	driverA = strings.TrimSpace(driverA)
	driverB = strings.TrimSpace(driverB)
	if driverA == "" || driverB == "" {
		return &HeadToHeadData{Events: []HeadToHeadEvent{}}, nil
	}
	keyA := canonicalDriverKey(driverA)
	keyB := canonicalDriverKey(driverB)
	if keyA == "" || keyB == "" || keyA == keyB {
		return &HeadToHeadData{Events: []HeadToHeadEvent{}}, nil
	}

	events, err := LoadEvents(dataDir, seriesID)
	if err != nil || len(events) == 0 {
		return &HeadToHeadData{Events: []HeadToHeadEvent{}}, nil
	}

	if strings.TrimSpace(season) == "" {
		season = ""
	}

	var out []HeadToHeadEvent

	for _, ev := range events {
		if season != "" && ev.Season != season {
			continue
		}
		if isExhibitionEvent(seriesID, ev.ID) {
			continue
		}

		detail, err := LoadEventDetail(dataDir, ev.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		rr, ok := detail.Tables["race_results"]
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			continue
		}

		colDriver := firstColIndex(rr.Headers, "Driver")
		if colDriver < 0 {
			continue
		}
		colPos := firstColIndex(rr.Headers, "Pos", "Fin")
		colGrid := firstColIndex(rr.Headers, "Grid", "St", "Start", "Started", "Start Pos")
		colPts := firstColIndex(rr.Headers, "Points", "Pts")

		// Очки за стейджи в этой гонке.
		stagePointsByKey := make(map[string]int)
		for sn := 1; sn <= 2; sn++ {
			st, ok := StageN(detail.Tables, sn)
			if !ok {
				continue
			}
			sDriverCol := colIndex(st.Headers, "Driver")
			sPtsCol := colIndex(st.Headers, "Points")
			if sPtsCol < 0 {
				sPtsCol = colIndex(st.Headers, "Pts")
			}
			if sDriverCol < 0 || sPtsCol < 0 {
				continue
			}
			for _, row := range st.Rows {
				if sDriverCol >= len(row) || sPtsCol >= len(row) {
					continue
				}
				name := strings.TrimSpace(row[sDriverCol])
				if name == "" {
					continue
				}
				k := canonicalDriverKey(name)
				if k == "" {
					continue
				}
				pts := 0
				for _, c := range strings.TrimSpace(row[sPtsCol]) {
					if c >= '0' && c <= '9' {
						pts = pts*10 + int(c-'0')
					}
				}
				stagePointsByKey[k] += pts
			}
		}

	type perDriver struct {
		pos    int
		grid   int
		points int
		found  bool
	}

	var a perDriver
	var b perDriver

	for rowIdx, row := range rr.Rows {
		if colDriver >= len(row) {
			continue
		}
		name := strings.TrimSpace(row[colDriver])
		if name == "" {
			continue
		}
		k := canonicalDriverKey(name)
		if k != keyA && k != keyB {
			continue
		}
		// Финиш.
		pos := 0
		if colPos >= 0 && colPos < len(row) {
			rawPos := strings.TrimSpace(row[colPos])
			if rawPos != "" {
				pos = atoiSafe(rawPos)
				if pos == 0 {
					// Некорректная позиция (NC/прочерк) — используем индекс строки.
					pos = rowIdx + 1
				}
			}
		}
		// Стартовая позиция (как "квалификация" в чарте).
		grid := 0
		if colGrid >= 0 && colGrid < len(row) {
			grid = atoiSafe(row[colGrid])
		}
		// Очки за гонку.
		racePts := 0
		if colPts >= 0 && colPts < len(row) {
			for _, c := range strings.TrimSpace(row[colPts]) {
				if c >= '0' && c <= '9' {
					racePts = racePts*10 + int(c-'0')
				}
			}
		}
		totalPts := racePts + stagePointsByKey[k]

		switch k {
		case keyA:
			a.pos = pos
			a.grid = grid
			a.points = totalPts
			a.found = true
		case keyB:
			b.pos = pos
			b.grid = grid
			b.points = totalPts
			b.found = true
		}
	}

	// В head-to-head включаем только гонки, где оба пилота реально участвовали/имеют запись.
	if !a.found || !b.found {
		continue
	}

	label := strings.TrimSpace(ev.Name)
	if label == "" {
		label = ev.ID
	}
	out = append(out, HeadToHeadEvent{
		EventID: ev.ID,
		Label:   label,
		PointsA: float64(a.points),
		PointsB: float64(b.points),
		QualiA:  float64(a.grid),
		QualiB:  float64(b.grid),
		FinishA: float64(a.pos),
		FinishB: float64(b.pos),
	})
	}

	if out == nil {
		out = []HeadToHeadEvent{}
	}
	return &HeadToHeadData{Events: out}, nil
}

