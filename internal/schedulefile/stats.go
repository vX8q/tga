package schedulefile

import (
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
)

// buildDriverStatsFromJSON собирает DriverStatsData из JSON (события + детали с race_results/stage1/stage2).
// Используется как fallback, когда БД пуста или не используется.
func buildDriverStatsFromJSON(dataDir string, seriesID string, season string) (*DriverStatsData, error) {
	// Для Supercars используем отдельный парсер, т.к. формат JSON отличается (race.sessions вместо race_results).
	if strings.EqualFold(seriesID, "SUPERCARS") {
		return buildSupercarsDriverStatsFromJSON(dataDir, season)
	}
	if strings.TrimSpace(season) == "" {
		season = config.CurrentSeason
	}
	events, err := LoadEvents(dataDir, seriesID)
	if err != nil {
		log.Printf("stats JSON fallback %s: LoadEvents failed: %v", seriesID, err)
		return &DriverStatsData{Rows: []DriverStatsRow{}, Teams: []TeamStatsRow{}, Manufacturers: []ManufacturerStatsRow{}}, nil
	}
	if len(events) == 0 {
		path := filepath.Join(dataDir, "schedules", strings.ToLower(seriesID)+".json")
		log.Printf("stats JSON fallback %s: no events (file missing or empty? path=%s)", seriesID, path)
		return &DriverStatsData{Rows: []DriverStatsRow{}, Teams: []TeamStatsRow{}, Manufacturers: []ManufacturerStatsRow{}}, nil
	}
	today := time.Now().Format("2006-01-02")
	eventsWithResults := 0
	// Для IndyCar manufacturer берём как бренд двигателя по номеру машины из Teams.
	var indyEngineByCar map[string]string
	if strings.EqualFold(seriesID, "INDYCAR") {
		if teams, err := LoadTeams(dataDir, seriesID); err == nil && teams != nil {
			m := make(map[string]string)
			for _, t := range teams.Teams {
				num := strings.TrimSpace(t.Number)
				if num == "" {
					continue
				}
				engine := strings.TrimSpace(t.Manufacturer)
				if engine == "" {
					continue
				}
				m[num] = engine
			}
			if len(m) > 0 {
				indyEngineByCar = m
			}
		}
	}

	type driverAcc struct {
		driver       string
		team         string
		manufacturer string
		car          string
		races        int
		wins         int
		top2         int
		top3         int
		poles        int
		top5         int
		top10        int
		top15        int
		top20        int
		sumFinish    float64
		sumStart     float64
		sumLaps      int
		totalLaps    int
		sumPosDiff   float64
		posDiffCnt   int
		stageWins    int
		stagePoints  int
		lapsLed      int
	}
	byDriver := make(map[string]*driverAcc)

	for _, e := range events {
		if e.Season != season {
			continue
		}
		if isExhibitionEvent(seriesID, e.ID) {
			continue
		}
		if strings.EqualFold(seriesID, "NASCAR_CUP") && e.StartDate > today {
			continue
		}
		detail, err := LoadEventDetail(dataDir, e.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		rr, ok := detail.Tables["race_results"]
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			continue
		}
		colPos := firstColIndex(rr.Headers, "Pos", "Fin")
		colGrid := firstColIndex(rr.Headers, "Grid", "St", "Start", "Started", "Start Pos")
		colNo := firstColIndex(rr.Headers, "No", "No.", "#", "Car")
		colDriver := firstColIndex(rr.Headers, "Driver")
		// Open-wheel series (F1/F2/F3) in event JSON often use "Constructor" instead of "Team".
		// Use both to ensure we populate team/clickable constructor correctly.
		colTeam := firstColIndex(rr.Headers, "Team", "Constructor")
		colManu := firstColIndex(rr.Headers, "Manufacturer", "Chassis", "Make")
		colLaps := firstColIndex(rr.Headers, "Laps")
		colLed := firstColIndex(rr.Headers, "Led", "Laps Led")
		if colDriver < 0 {
			continue
		}
		eventsWithResults++
		raceLaps := 0
		for _, row := range rr.Rows {
			if l := atoiSafe(valueAt(row, colLaps)); l > raceLaps {
				raceLaps = l
			}
		}
		if raceLaps == 0 && detail.Laps != "" {
			raceLaps = atoiSafe(detail.Laps)
		}
		stageWinsThisRace := make(map[string]int)
		stagePointsThisRace := make(map[string]int)
		for sn := 1; sn <= 2; sn++ {
			st, ok := StageN(detail.Tables, sn)
			if !ok {
				continue
			}
			spos := firstColIndex(st.Headers, "Pos", "Fin")
			sDriver := firstColIndex(st.Headers, "Driver")
			sNo := firstColIndex(st.Headers, "No", "#", "Car")
			if sDriver < 0 {
				continue
			}
			for _, row := range st.Rows {
				stagePos := atoiSafe(valueAt(row, spos))
				if stagePos <= 0 {
					continue
				}
				dr := valueAt(row, sDriver)
				no := valueAt(row, sNo)
				// Use canonicalDriverKey so we can match with race_results aggregation keys.
				key := canonicalDriverKey(dr) + "\t" + no
				if stagePos == 1 {
					stageWinsThisRace[key]++
				}
				if stagePos <= 10 {
					// NASCAR stage scoring: P1..P10 = 10..1 points.
					stagePointsThisRace[key] += 11 - stagePos
				}
			}
		}
		for rowIdx, row := range rr.Rows {
			driverName := valueAt(row, colDriver)
			// F1: нормализуем Carlos Sainz -> Carlos Sainz Jr.
			if strings.EqualFold(seriesID, "F1") && strings.TrimSpace(driverName) == "Carlos Sainz" {
				driverName = "Carlos Sainz Jr."
			}
			driverName = preferredDriverName(driverName)
			if driverName == "" {
				continue
			}
			carNumber := valueAt(row, colNo)
			teamName := valueAt(row, colTeam)
			manufacturer := valueAt(row, colManu)
			if manufacturer == "" && indyEngineByCar != nil && carNumber != "" {
				if eng, ok := indyEngineByCar[carNumber]; ok {
					manufacturer = eng
				}
			}
			posStr := strings.TrimSpace(valueAt(row, colPos))
			pos := atoiSafe(posStr)
			if pos <= 0 && posStr != "" && !isAllDigits(posStr) {
				// Для нечисловых значений позиции (DNF, NC, Ret и т.п.) используем индекс строки как позицию.
				pos = rowIdx + 1
			}
			grid := atoiSafe(valueAt(row, colGrid))
			laps := atoiSafe(valueAt(row, colLaps))
			led := 0
			if colLed >= 0 {
				led = atoiSafe(valueAt(row, colLed))
			}
			driverKey := canonicalDriverKey(driverName) + "\t" + carNumber
			if byDriver[driverKey] == nil {
				byDriver[driverKey] = &driverAcc{
					driver: driverName, team: teamName, manufacturer: manufacturer, car: carNumber,
				}
			}
			acc := byDriver[driverKey]
			if acc.team == "" {
				acc.team = teamName
			}
			if acc.manufacturer == "" {
				acc.manufacturer = manufacturer
			}
			// Старт засчитываем только если пилот реально выехал на дистанцию (есть хотя бы один круг).
			didStart := laps > 0
			if didStart {
				acc.races++
			}
			if grid == 1 {
				acc.poles++
			}
			if pos == 1 {
				acc.wins++
			}
			if pos == 2 {
				acc.top2++
			}
			if pos == 3 {
				acc.top3++
			}
			if pos >= 1 && pos <= 5 {
				acc.top5++
			}
			if pos >= 1 && pos <= 10 {
				acc.top10++
			}
			if pos >= 1 && pos <= 15 {
				acc.top15++
			}
			if pos >= 1 && pos <= 20 {
				acc.top20++
			}
			// В средний финиш включаем только тех, кто стартовал.
			if didStart && pos > 0 {
				acc.sumFinish += float64(pos)
			}
			if grid > 0 {
				acc.sumStart += float64(grid)
			}
			acc.sumLaps += laps
			acc.totalLaps += raceLaps
			if grid > 0 && pos > 0 {
				acc.sumPosDiff += float64(grid - pos)
				acc.posDiffCnt++
			}
			acc.stageWins += stageWinsThisRace[driverKey]
			acc.stagePoints += stagePointsThisRace[driverKey]
			acc.lapsLed += led
		}
	}
	if eventsWithResults == 0 && len(events) > 0 {
		log.Printf("stats JSON fallback %s: %d events loaded but none had race_results (check data/events/%s*.json)", seriesID, len(events), strings.ToLower(seriesID))
	}
	if eventsWithResults > 0 {
		log.Printf("stats JSON fallback %s: %d events with results, %d drivers", seriesID, eventsWithResults, len(byDriver))
	}
	var out []DriverStatsRow
	for _, a := range byDriver {
		avgFinish := 0.0
		if a.races > 0 && a.sumFinish > 0 {
			avgFinish = a.sumFinish / float64(a.races)
		}
		avgStart := 0.0
		if a.races > 0 && a.sumStart > 0 {
			avgStart = a.sumStart / float64(a.races)
		}
		lapsPct := 0.0
		if a.totalLaps > 0 {
			lapsPct = 100.0 * float64(a.sumLaps) / float64(a.totalLaps)
		}
		posDiff := 0.0
		if a.posDiffCnt > 0 {
			posDiff = a.sumPosDiff / float64(a.posDiffCnt)
		}
		avgStagePoints := 0.0
		if a.races > 0 {
			avgStagePoints = float64(a.stagePoints) / float64(a.races)
		}
		out = append(out, DriverStatsRow{
			Driver:           a.driver,
			Team:             a.team,
			Manufacturer:     a.manufacturer,
			Car:              a.car,
			Races:            a.races,
			Wins:             a.wins,
			Top2:             a.top2,
			Top3:             a.top3,
			Podiums:          a.wins + a.top2 + a.top3,
			Poles:            a.poles,
			Top5:             a.top5,
			Top10:            a.top10,
			Top15:            a.top15,
			Top20:            a.top20,
			AvgFinish:        roundTo(avgFinish, 2),
			AvgStart:         roundTo(avgStart, 2),
			StageWins:        a.stageWins,
			StagePoints:      a.stagePoints,
			AvgStagePoints:   roundTo(avgStagePoints, 2),
			LapsLed:          a.lapsLed,
			LapsCompleted:    a.sumLaps,
			LapsCompletedPct: roundTo(lapsPct, 1),
			PositionDiff:     roundTo(posDiff, 2),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Wins != out[j].Wins {
			return out[i].Wins > out[j].Wins
		}
		if out[i].Top5 != out[j].Top5 {
			return out[i].Top5 > out[j].Top5
		}
		if out[i].Top10 != out[j].Top10 {
			return out[i].Top10 > out[j].Top10
		}
		return out[i].Driver < out[j].Driver
	})

	// Для F1 дополнительно подтягиваем manufacturer, Q2/Q3 и среднюю квалификацию.
	var f1Qual map[string]q2q3Count
	if strings.EqualFold(seriesID, "F1") {
		// Manufacturer из teams/f1.json.
		if teamsData, err := LoadTeams(dataDir, "f1"); err == nil && teamsData != nil && len(teamsData.Teams) > 0 {
			byDriverCar := make(map[string]string)
			byDriver := make(map[string]string)
			byCar := make(map[string]string)
			for _, t := range teamsData.Teams {
				driverKey := strings.TrimSpace(strings.ToLower(t.Driver))
				num := strings.TrimSpace(t.Number)
				man := strings.TrimSpace(t.Manufacturer)
				if man == "" {
					continue
				}
				if driverKey != "" || num != "" {
					key := driverKey + "|" + num
					byDriverCar[key] = man
				}
				if driverKey != "" {
					byDriver[driverKey] = man
				}
				if num != "" {
					byCar[num] = man
				}
			}
			for i := range out {
				if strings.TrimSpace(out[i].Manufacturer) != "" {
					continue
				}
				driverKey := strings.TrimSpace(strings.ToLower(out[i].Driver))
				carNum := strings.TrimSpace(out[i].Car)
				key := driverKey + "|" + carNum
				if man := byDriverCar[key]; man != "" {
					out[i].Manufacturer = man
				} else if man := byCar[carNum]; man != "" {
					out[i].Manufacturer = man
				} else if man := byDriver[driverKey]; man != "" {
					out[i].Manufacturer = man
				}
			}
		}
		// Q2/Q3 и avg_qualifying из квалификаций.
		if q2q3, err := loadF1QualifyingQ2Q3Passes(dataDir, season); err == nil && len(q2q3) > 0 {
			f1Qual = q2q3
			for i := range out {
				key := strings.TrimSpace(strings.ToLower(out[i].Driver))
				if v, ok := q2q3[key]; ok {
					out[i].Q2Passes = v.Q2
					out[i].Q3Passes = v.Q3
					if v.Count > 0 {
						out[i].AvgQualifying = roundTo(v.SumPos/float64(v.Count), 2)
					}
				}
			}
		}
	}

	// Для формульных серий (F1/F2/F3) объединяем дубликаты строк одного пилота:
	// в разных событиях может отличаться написание команды/шасси, но на странице
	// статистики хотим одну строку на пилота.
	if strings.EqualFold(seriesID, "F1") || strings.EqualFold(seriesID, "F2") || strings.EqualFold(seriesID, "F3") {
		out = mergeOpenWheelDriverStatsRows(out)
		// После mergeOpenWheelDriverStatsRows не стоит суммировать poles по дубликатам,
		// поэтому для F1 подставляем poles отдельной операцией.
		if strings.EqualFold(seriesID, "F1") && f1Qual != nil && len(f1Qual) > 0 {
			for i := range out {
				key := strings.TrimSpace(strings.ToLower(out[i].Driver))
				if v, ok := f1Qual[key]; ok {
					out[i].Poles = v.Poles
				}
			}
		}
	}
	// Для Team Stats по сток‑кар сериям сохраняем исходные строки до merge,
	// чтобы разные команды одного пилота не склеивались в "A / B".
	teamSourceRows := out
	// Для сток‑кар серий также объединяем дубли одного пилота в одну строку.
	// В отличие от open-wheel, здесь можем встретить разные номера/команды за сезон,
	// поэтому mergeStockCarDriverStatsRows склеивает Car и Team через " / ".
	if strings.EqualFold(seriesID, "NASCAR_CUP") ||
		strings.EqualFold(seriesID, "NOAPS") ||
		strings.EqualFold(seriesID, "NASCAR_TRUCK") ||
		strings.EqualFold(seriesID, "ARCA") ||
		strings.EqualFold(seriesID, "NASCAR_MODIFIED") {
		teamSourceRows = append([]DriverStatsRow(nil), out...)
		out = mergeStockCarDriverStatsRows(out)
	}

	mans := aggregateByManufacturer(out)
	teams := aggregateByTeam(teamSourceRows)

	return &DriverStatsData{Rows: out, Teams: teams, Manufacturers: mans}, nil
}

// buildSupercarsDriverStatsFromJSON собирает статистику пилотов Supercars из JSON,
// используя таблицы race.sessions (Race 1–3 и т.д.).
func buildSupercarsDriverStatsFromJSON(dataDir string, season string) (*DriverStatsData, error) {
	if strings.TrimSpace(season) == "" {
		season = config.CurrentSeason
	}
	events, err := LoadEvents(dataDir, "SUPERCARS")
	if err != nil || len(events) == 0 {
		return &DriverStatsData{Rows: []DriverStatsRow{}, Teams: []TeamStatsRow{}, Manufacturers: []ManufacturerStatsRow{}}, nil
	}

	// Мапы номер → производитель и номер → команда из Teams.
	// Ключи нормализуем: исходная строка, без ведущих нулей и zero‑pad до 2 символов (как в EnrichSupercarsEvent),
	// чтобы совпадать с форматами "07"/"7"/"07".
	engineByCar := make(map[string]string)
	teamByCar := make(map[string]string)
	if teams, err := LoadTeams(dataDir, "SUPERCARS"); err == nil && teams != nil {
		for _, t := range teams.Teams {
			rawNum := strings.TrimSpace(t.Number)
			if rawNum == "" {
				continue
			}
			engine := strings.TrimSpace(t.Manufacturer)
			team := strings.TrimSpace(t.Team)

			// Нормализуем ключи номера.
			numVariants := make(map[string]struct{})
			numVariants[rawNum] = struct{}{}
			if n, err := strconv.Atoi(strings.TrimLeft(rawNum, "0")); err == nil {
				numInt := strconv.Itoa(n)
				numVariants[numInt] = struct{}{}
				if n >= 1 && n <= 9 {
					numVariants[fmt.Sprintf("%02d", n)] = struct{}{}
				}
			}

			for num := range numVariants {
				if engine != "" {
					engineByCar[num] = engine
				}
				if team != "" {
					teamByCar[num] = team
				}
			}
		}
	}

	type acc struct {
		driver       string
		team         string
		engine       string
		car          string
		races        int
		wins         int
		top5         int
		top10        int
		sumFinish    float64
		// Для Supercars в race.sessions нет явной стартовой позиции, поэтому
		// sumStart/posDiffCount используем как суммарную позицию в квалификации
		// и количество квалификационных попаданий — для Avg. Qualifying.
		sumStart     float64
		posDiffCount int
	}
	byKey := make(map[string]*acc)

	for _, e := range events {
		if e.Season != season {
			continue
		}
		raw, err := ReadEventDetailFile(dataDir, e.ID)
		if err != nil {
			continue
		}
		var root map[string]interface{}
		if err := json.Unmarshal(raw, &root); err != nil {
			continue
		}
		tables, ok := root["tables"].(map[string]interface{})
		if !ok {
			continue
		}
		raceAny, ok := tables["race"]
		if ok {
			raceMap, ok := raceAny.(map[string]interface{})
			if !ok {
				goto QUALIFYING_ONLY
			}
			sessionsAny, ok := raceMap["sessions"].([]interface{})
			if !ok {
				goto QUALIFYING_ONLY
			}
			for _, sessAny := range sessionsAny {
				sessMap, ok := sessAny.(map[string]interface{})
				if !ok {
					continue
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
				colDriver := firstColIndex(headers, "Driver")
				colTeam := firstColIndex(headers, "Team")
				if colDriver < 0 || colPos < 0 {
					continue
				}
				for rowIdx, rAny := range rowsAny {
					rSlice, ok := rAny.([]interface{})
					if !ok {
						continue
					}
					row := make([]string, len(rSlice))
					for i := range rSlice {
						row[i] = strings.TrimSpace(fmt.Sprint(rSlice[i]))
					}
					posStr := valueAt(row, colPos)
					pos := atoiSafe(posStr)
					if pos <= 0 {
						// Для Supercars строки с Pos="NC" считаем последними в гонке.
						if strings.EqualFold(strings.TrimSpace(posStr), "NC") {
							pos = rowIdx + 1
						} else {
							continue
						}
					}
					driver := valueAt(row, colDriver)
					if driver == "" {
						continue
					}
					car := SupercarsCarToCanonical(valueAt(row, colNo))
					team := ""
					if colTeam >= 0 {
						team = valueAt(row, colTeam)
					}
					engine := ""
					if car != "" {
						engine = engineByCar[car]
						// Название команды и производителя всегда берём из Teams (как на /series/supercars/teams).
						if tName, ok := teamByCar[car]; ok && tName != "" {
							team = tName
						}
					}
					key := canonicalDriverKey(driver) + "\t" + car
					a := byKey[key]
					if a == nil {
						a = &acc{driver: driver, team: team, engine: engine, car: car}
						byKey[key] = a
					}
					if a.team == "" {
						a.team = team
					}
					if a.engine == "" {
						a.engine = engine
					}
					a.races++
					if pos == 1 {
						a.wins++
					}
					if pos >= 1 && pos <= 5 {
						a.top5++
					}
					if pos >= 1 && pos <= 10 {
						a.top10++
					}
					a.sumFinish += float64(pos)
				}
			}
		}

		// Avg. Start для Supercars берём из таблиц starting_lineup (стартовая решётка), а не из квалификации.
		if slAny, ok := tables["starting_lineup"]; ok {
			if slMap, ok := slAny.(map[string]interface{}); ok {
				if sessList, ok := slMap["sessions"].([]interface{}); ok {
					for _, sessAny := range sessList {
						sessMap, ok := sessAny.(map[string]interface{})
						if !ok {
							continue
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
						colDriver := firstColIndex(headers, "Driver")
						if colPos < 0 || colDriver < 0 {
							continue
						}
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
							driver := valueAt(row, colDriver)
							if driver == "" {
								continue
							}
							car := SupercarsCarToCanonical(valueAt(row, colNo))
							key := canonicalDriverKey(driver) + "\t" + car
							a := byKey[key]
							if a == nil {
								continue
							}
							a.sumStart += float64(pos)
							a.posDiffCount++
						}
					}
				}
			}
		}

	QUALIFYING_ONLY:
		// Для Supercars avg_start уже заполнен из starting_lineup; квалификацию не используем.
		if _, usedSL := tables["starting_lineup"]; !usedSL {
		if qualAny, ok := tables["qualifying"]; ok {
			qualMap, ok := qualAny.(map[string]interface{})
			if ok {
				// Может быть либо массив sessions, либо одна таблица.
				if sessListAny, ok := qualMap["sessions"]; ok {
					if sessSlice, ok := sessListAny.([]interface{}); ok {
						for _, sessAny := range sessSlice {
							sessMap, ok := sessAny.(map[string]interface{})
							if !ok {
								continue
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
							colPos := firstColIndex(headers, "Pos")
							colNo := firstColIndex(headers, "No", "No.", "#", "Car")
							colDriver := firstColIndex(headers, "Driver")
							colTeam := firstColIndex(headers, "Team")
							if colDriver < 0 || colPos < 0 {
								continue
							}
							for _, rAny := range rowsAny {
								rSlice, ok := rAny.([]interface{})
								if !ok {
									continue
								}
								row := make([]string, len(rSlice))
								for i := range rSlice {
									row[i] = strings.TrimSpace(fmt.Sprint(rSlice[i]))
								}
								// Пропускаем строку‑разделитель вроде "Shoot Out Race 2".
								pos := atoiSafe(valueAt(row, colPos))
								if pos <= 0 {
									continue
								}
								driver := valueAt(row, colDriver)
								if driver == "" {
									continue
								}
								car := SupercarsCarToCanonical(valueAt(row, colNo))
								team := ""
								if colTeam >= 0 {
									team = valueAt(row, colTeam)
								}
								engine := ""
								if car != "" {
									engine = engineByCar[car]
									// Для квалификаций тоже подставляем команду по номеру из Teams.
									if tName, ok := teamByCar[car]; ok && tName != "" {
										team = tName
									}
								}
								key := driver + "\t" + car
								a := byKey[key]
								if a == nil {
									a = &acc{driver: driver, team: team, engine: engine, car: car}
									byKey[key] = a
								}
								if a.team == "" {
									a.team = team
								}
								if a.engine == "" {
									a.engine = engine
								}
								a.sumStart += float64(pos)
								a.posDiffCount++
							}
						}
					}
				} else {
					// Вариант: qualifying как одна таблица с headers/rows на верхнем уровне.
					headersAny, ok := qualMap["headers"].([]interface{})
					if ok {
						var headers []string
						for _, h := range headersAny {
							headers = append(headers, strings.TrimSpace(fmt.Sprint(h)))
						}
						rowsAny, ok := qualMap["rows"].([]interface{})
						if ok {
							colPos := firstColIndex(headers, "Pos")
							colNo := firstColIndex(headers, "No", "No.", "#", "Car")
							colDriver := firstColIndex(headers, "Driver")
							colTeam := firstColIndex(headers, "Team")
							if colDriver >= 0 && colPos >= 0 {
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
									driver := valueAt(row, colDriver)
									if driver == "" {
										continue
									}
									car := SupercarsCarToCanonical(valueAt(row, colNo))
									team := ""
									if colTeam >= 0 {
										team = valueAt(row, colTeam)
									}
									engine := ""
									if car != "" {
										engine = engineByCar[car]
									}
									key := driver + "\t" + car
									a := byKey[key]
									if a == nil {
										a = &acc{driver: driver, team: team, engine: engine, car: car}
										byKey[key] = a
									}
									if a.team == "" {
										a.team = team
									}
									if a.engine == "" {
										a.engine = engine
									}
									a.sumStart += float64(pos)
									a.posDiffCount++
								}
							}
						}
					}
				}
			}
		}
		}
	}

	var rows []DriverStatsRow
	for _, a := range byKey {
		if a.races == 0 {
			continue
		}
		avgFinish := 0.0
		if a.sumFinish > 0 {
			avgFinish = a.sumFinish / float64(a.races)
		}
		avgStart := 0.0
		if a.sumStart > 0 && a.posDiffCount > 0 {
			avgStart = a.sumStart / float64(a.posDiffCount)
		}
		rows = append(rows, DriverStatsRow{
			Driver:       a.driver,
			Team:         a.team,
			Manufacturer: a.engine,
			Car:          a.car,
			Races:        a.races,
			Wins:         a.wins,
			Top5:         a.top5,
			Top10:        a.top10,
			AvgStart:     roundTo(avgStart, 2),
			AvgFinish:    roundTo(avgFinish, 2),
		})
	}
	// Объединяем дубликаты: в разных событиях один пилот может быть записан по-разному (Matthew Payne / Matt Payne).
	// Группируем по каноническому номеру машины и сливаем статистику.
	rows = mergeSupercarsStatsRowsByCar(rows)
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Wins != rows[j].Wins {
			return rows[i].Wins > rows[j].Wins
		}
		if rows[i].Top5 != rows[j].Top5 {
			return rows[i].Top5 > rows[j].Top5
		}
		if rows[i].Top10 != rows[j].Top10 {
			return rows[i].Top10 > rows[j].Top10
		}
		return rows[i].Driver < rows[j].Driver
	})

	mans := aggregateByManufacturer(rows)
	teams := aggregateByTeam(rows)

	return &DriverStatsData{Rows: rows, Teams: teams, Manufacturers: mans}, nil
}

// mergeSupercarsStatsRowsByCar объединяет строки с одним каноническим номером машины (дубли из‑за разного написания имени в событиях).
func mergeSupercarsStatsRowsByCar(rows []DriverStatsRow) []DriverStatsRow {
	if len(rows) == 0 {
		return rows
	}
	byCar := make(map[string]*DriverStatsRow)
	for i := range rows {
		r := &rows[i]
		car := SupercarsCarToCanonical(strings.TrimSpace(r.Car))
		if existing, ok := byCar[car]; ok {
			prevRaces := existing.Races
			totalRaces := prevRaces + r.Races
			existing.Races = totalRaces
			existing.Wins += r.Wins
			existing.Top5 += r.Top5
			existing.Top10 += r.Top10
			existing.AvgFinish = (existing.AvgFinish*float64(prevRaces) + r.AvgFinish*float64(r.Races)) / float64(totalRaces)
			existing.AvgStart = (existing.AvgStart*float64(prevRaces) + r.AvgStart*float64(r.Races)) / float64(totalRaces)
			if r.Team != "" && existing.Team == "" {
				existing.Team = r.Team
			}
			if r.Manufacturer != "" && existing.Manufacturer == "" {
				existing.Manufacturer = r.Manufacturer
			}
			if r.Races > 0 && (existing.Driver == "" || r.Races > prevRaces) {
				existing.Driver = r.Driver
			}
			continue
		}
		r2 := *r
		r2.Car = car
		byCar[car] = &r2
	}
	var out []DriverStatsRow
	for _, r := range byCar {
		out = append(out, *r)
	}
	return out
}

// MergeSupercarsDriverStatsRows приводит номера 800→8 и объединяет строки одного пилота в одну (для данных из БД).
// Группировка по (canonicalDriverKey(driver), car), чтобы схлопнуть дубли при разном написании имени.
func MergeSupercarsDriverStatsRows(rows []DriverStatsRow) []DriverStatsRow {
	if len(rows) == 0 {
		return rows
	}
	type key struct {
		driver string
		car    string
	}
	merged := make(map[key]*DriverStatsRow)
	var order []key
	for i := range rows {
		r := &rows[i]
		car := SupercarsCarToCanonical(strings.TrimSpace(r.Car))
		canonDriver := canonicalDriverKey(strings.TrimSpace(r.Driver))
		k := key{driver: canonDriver, car: car}
		if existing, ok := merged[k]; ok {
			prevRaces := existing.Races
			totalRaces := prevRaces + r.Races
			if totalRaces == 0 {
				continue
			}
			existing.Races = totalRaces
			existing.Wins += r.Wins
			existing.Poles += r.Poles
			existing.Top5 += r.Top5
			existing.Top10 += r.Top10
			existing.Top15 += r.Top15
			existing.Top20 += r.Top20
			existing.StageWins += r.StageWins
			existing.StagePoints += r.StagePoints
			existing.LapsLed += r.LapsLed
			// Weighted averages by races
			existing.AvgFinish = (existing.AvgFinish*float64(prevRaces) + r.AvgFinish*float64(r.Races)) / float64(totalRaces)
			existing.AvgStart = (existing.AvgStart*float64(prevRaces) + r.AvgStart*float64(r.Races)) / float64(totalRaces)
			existing.LapsCompletedPct = (existing.LapsCompletedPct*float64(prevRaces) + r.LapsCompletedPct*float64(r.Races)) / float64(totalRaces)
			existing.PositionDiff = (existing.PositionDiff*float64(prevRaces) + r.PositionDiff*float64(r.Races)) / float64(totalRaces)
			if totalRaces > 0 {
				existing.AvgStagePoints = float64(existing.StagePoints) / float64(totalRaces)
			}
			if r.Team != "" {
				existing.Team = r.Team
			}
			if r.Manufacturer != "" {
				existing.Manufacturer = r.Manufacturer
			}
			// Оставляем отображаемое имя из строки с большим числом гонок
			if r.Races > prevRaces {
				existing.Driver = r.Driver
			}
			continue
		}
		r2 := *r
		r2.Car = car
		merged[k] = &r2
		order = append(order, k)
	}
	var out []DriverStatsRow
	for _, k := range order {
		out = append(out, *merged[k])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Wins != out[j].Wins {
			return out[i].Wins > out[j].Wins
		}
		if out[i].Top5 != out[j].Top5 {
			return out[i].Top5 > out[j].Top5
		}
		if out[i].Top10 != out[j].Top10 {
			return out[i].Top10 > out[j].Top10
		}
		return out[i].Driver < out[j].Driver
	})
	return out
}

// mergeStockCarDriverStatsRows объединяет дубликаты строк статистики сток‑кар серий
// (NASCAR Cup/Truck/Modified, ARCA, NOAPS), если в агрегированном вью driver_stats_stockcar
// один и тот же пилот оказался с разными driver_id (например, из‑за правок импорта или разного написания имени).
// Ключом считаем canonicalDriverKey(driver) — то есть агрегируем по человеку, а не по номеру машины.
func mergeStockCarDriverStatsRows(rows []DriverStatsRow) []DriverStatsRow {
	if len(rows) == 0 {
		return rows
	}
	type key struct {
		driver string
	}
	merged := make(map[key]*DriverStatsRow)
	var order []key
	for i := range rows {
		r := &rows[i]
		canonDriver := canonicalDriverKey(strings.TrimSpace(r.Driver))
		k := key{driver: canonDriver}
		if existing, ok := merged[k]; ok {
			prevRaces := existing.Races
			totalRaces := prevRaces + r.Races
			if totalRaces == 0 {
				continue
			}
			existing.Races = totalRaces
			existing.Wins += r.Wins
			existing.Poles += r.Poles
			existing.Top5 += r.Top5
			existing.Top10 += r.Top10
			existing.Top15 += r.Top15
			existing.Top20 += r.Top20
			existing.StageWins += r.StageWins
			existing.StagePoints += r.StagePoints
			existing.LapsLed += r.LapsLed
			// Взвешенные средние по количеству гонок.
			existing.AvgFinish = (existing.AvgFinish*float64(prevRaces) + r.AvgFinish*float64(r.Races)) / float64(totalRaces)
			existing.AvgStart = (existing.AvgStart*float64(prevRaces) + r.AvgStart*float64(r.Races)) / float64(totalRaces)
			existing.LapsCompletedPct = (existing.LapsCompletedPct*float64(prevRaces) + r.LapsCompletedPct*float64(r.Races)) / float64(totalRaces)
			existing.PositionDiff = (existing.PositionDiff*float64(prevRaces) + r.PositionDiff*float64(r.Races)) / float64(totalRaces)
			if totalRaces > 0 {
				existing.AvgStagePoints = float64(existing.StagePoints) / float64(totalRaces)
			}
			// Team/Car: если значения разные, склеиваем через " / ".
			// Это позволяет не терять данные при дублях одного пилота с разными источниками.
			if strings.TrimSpace(r.Team) != "" {
				existing.Team = joinWithSlashUnique(existing.Team, r.Team)
			}
			if r.Manufacturer != "" && (existing.Manufacturer == "" || r.Races > prevRaces) {
				existing.Manufacturer = r.Manufacturer
			}
			if strings.TrimSpace(r.Car) != "" {
				existing.Car = joinWithSlashUnique(existing.Car, strings.TrimSpace(r.Car))
			}
			// Для отображения имени берём вариант с большим числом гонок (и непустой строкой).
			if r.Races > prevRaces && strings.TrimSpace(r.Driver) != "" {
				existing.Driver = r.Driver
			}
			continue
		}
		r2 := *r
		merged[k] = &r2
		order = append(order, k)
	}
	var out []DriverStatsRow
	for _, k := range order {
		out = append(out, *merged[k])
	}
	return out
}

func joinWithSlashUnique(base, next string) string {
	b := strings.TrimSpace(base)
	n := strings.TrimSpace(next)
	if b == "" {
		return n
	}
	if n == "" {
		return b
	}
	parts := strings.Split(b, "/")
	for _, p := range parts {
		if strings.EqualFold(strings.TrimSpace(p), n) {
			return b
		}
	}
	return b + " / " + n
}

