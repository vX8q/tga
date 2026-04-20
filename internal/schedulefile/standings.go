package schedulefile

import (
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
)

// RecomputeCompletedRacesFromFilled выставляет CompletedRaces по факту: в начало попадают только те коды из RaceOrder,
// для которых хотя бы в одной строке есть непустое значение (не "", не "—", не "-"). Нужно для Supercars после enrich.
func RecomputeCompletedRacesFromFilled(data *StandingsData) {
	if data == nil || len(data.RaceOrder) == 0 || len(data.Rows) == 0 {
		return
	}
	var filled int
	for _, code := range data.RaceOrder {
		hasData := false
		for i := range data.Rows {
			if data.Rows[i].Races == nil {
				continue
			}
			if strings.TrimSpace(data.Rows[i].Races[code]) != "" {
				hasData = true
				break
			}
		}
		if !hasData {
			break
		}
		filled++
	}
	data.CompletedRaces = make([]string, 0, filled)
	for i := 0; i < filled && i < len(data.RaceOrder); i++ {
		data.CompletedRaces = append(data.CompletedRaces, data.RaceOrder[i])
	}
}

// EnsureCompletedRaces заполняет data.CompletedRaces по наличию таблицы race_results в деталях событий (если ещё пусто).
func EnsureCompletedRaces(dataDir string, seriesID string, data *StandingsData) {
	if data == nil || len(data.RaceOrder) == 0 || len(data.CompletedRaces) > 0 {
		return
	}
	events, err := LoadEvents(dataDir, seriesID)
	if err != nil || len(events) == 0 {
		return
	}
	var completed []string
	for i, ev := range events {
		if i >= len(data.RaceOrder) {
			break
		}
		detail, err := LoadEventDetail(dataDir, ev.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		rr, ok := detail.Tables["race_results"]
		// F1/F2/F3 и спец‑случаи: допускаем таблицу "race" или race.sessions как источник результатов.
		if !ok || len(rr.Rows) == 0 {
			if ra, okRace := detail.Tables["race"]; okRace && len(ra.Rows) > 0 {
				rr = ra
				ok = true
			}
		}
		if !ok || len(rr.Rows) == 0 {
			if sessions, errSess := LoadEventRaceSessions(dataDir, ev.ID); errSess == nil && len(sessions) > 0 {
				ok = true
			}
		}
		if !ok {
			continue
		}
		completed = append(completed, data.RaceOrder[i])
	}
	data.CompletedRaces = completed
}

// SplitBaseIneligible разделяет base.Rows на eligible (без (i)) и ineligible (с (i)), обновляет base на месте.
// Вызывать при возврате standings из файла, чтобы пилоты (i) отображались в отдельной таблице.
func SplitBaseIneligible(base *StandingsData) {
	if base == nil || len(base.Rows) == 0 {
		return
	}
	var eligible, ineligible []StandingRow
	for _, r := range base.Rows {
		if strings.Contains(r.Driver, "(i)") {
			ineligible = append(ineligible, r)
		} else {
			eligible = append(eligible, r)
		}
	}
	sort.Slice(ineligible, func(i, j int) bool {
		pi, pj := atoi(ineligible[i].Points), atoi(ineligible[j].Points)
		if pi != pj {
			return pi > pj
		}
		return ineligible[i].Driver < ineligible[j].Driver
	})
	for i := range eligible {
		eligible[i].Pos = i + 1
	}
	for i := range ineligible {
		ineligible[i].Pos = i + 1
	}
	base.Rows = eligible
	base.Ineligible = ineligible
}

// BuildStandingsFromEvents собирает турнирную таблицу из таблиц гонок: позиция в гонке и очки — из race_results,
// очки стейджей — из stage1 и stage2 (если есть). race_order берётся из существующего standings JSON.
// Если season непустой — учитываются только события этого сезона.
func BuildStandingsFromEvents(dataDir string, seriesID string, season string) (*StandingsData, error) {
	if strings.TrimSpace(season) == "" {
		season = config.CurrentSeason
	}
	// Для F1 начиная с появления спринт‑уикендов строим RaceOrder с отдельными колонками
	// под спринт и основную гонку (RnS / RnF), если в событии реально есть sprint‑сессия.
	isF1SprintSeason := strings.EqualFold(seriesID, "F1")
	base, err := LoadStandings(dataDir, seriesID)
	if err != nil {
		return nil, err
	}
	// Если standings JSON отсутствует (base == nil) — строим базовый race_order по расписанию.
	if base == nil {
		events, err := LoadEvents(dataDir, seriesID)
		if err != nil || len(events) == 0 {
			return &StandingsData{Rows: []StandingRow{}}, nil
		}
		var raceOrder []string
		var eventNames []string
		round := 0
		for _, ev := range events {
			if ev.Season != season {
				continue
			}
			round++
			name := strings.TrimSpace(ev.Name)
			raceOrder = append(raceOrder, "R"+strconv.Itoa(round))
			eventNames = append(eventNames, name)
		}
		base = &StandingsData{RaceOrder: raceOrder, EventNames: eventNames}
	}
	raceOrder := base.RaceOrder
	if len(raceOrder) == 0 {
		SplitBaseIneligible(base)
		return base, nil
	}
	events, err := LoadEvents(dataDir, seriesID)
	if err != nil || len(events) == 0 {
		EnsureCompletedRaces(dataDir, seriesID, base)
		SplitBaseIneligible(base)
		return base, nil
	}
	// F1 2025: переопределяем RaceOrder/EventNames по реальному расписанию,
	// создавая по две колонки для спринт‑уикендов (Sprint + Feature).
	if isF1SprintSeason {
		var ro []string
		var names []string
		round := 0
		for _, ev := range events {
			if ev.Season != season {
				continue
			}
			round++
			name := strings.TrimSpace(ev.Name)
			if eventHasSprintRaceSession(dataDir, ev.ID) {
				baseCode := "R" + strconv.Itoa(round)
				ro = append(ro, baseCode+"S", baseCode+"F")
				names = append(names, name, name)
			} else {
				ro = append(ro, "R"+strconv.Itoa(round))
				names = append(names, name)
			}
		}
		if len(ro) > 0 {
			base.RaceOrder = ro
			base.EventNames = names
			raceOrder = ro
		}
	}
	// Для IndyCar manufacturer в таблицах результатов не хранится явно, поэтому берём
	// бренд двигателя из файла Teams по номеру машины.
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

	type accRow struct {
		driver       string
		car          string
		team         string
		manufacturer string
		races        map[string]string
		points       float64
		stages       int
	}
	parsePointsValue := func(raw string) float64 {
		s := strings.TrimSpace(raw)
		if s == "" {
			return 0
		}
		var b strings.Builder
		started := false
		for _, c := range s {
			if (c >= '0' && c <= '9') || c == '.' {
				b.WriteRune(c)
				started = true
				continue
			}
			if started {
				break
			}
		}
		if b.Len() == 0 {
			return 0
		}
		v, err := strconv.ParseFloat(b.String(), 64)
		if err != nil {
			return 0
		}
		return v
	}
	formatPointsValue := func(v float64) string {
		if math.Abs(v-math.Round(v)) < 1e-9 {
			return strconv.FormatInt(int64(math.Round(v)), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	byDriver := make(map[string]*accRow)
	var completedRaces []string
	raceIdx := 0
	today := time.Now().Format(dateFormat)
	isCupSeries := strings.EqualFold(seriesID, "NASCAR_CUP")
	isStockCarSeries := strings.EqualFold(seriesID, "NASCAR_CUP") ||
		strings.EqualFold(seriesID, "NOAPS") ||
		strings.EqualFold(seriesID, "NASCAR_TRUCK") ||
		strings.EqualFold(seriesID, "ARCA") ||
		strings.EqualFold(seriesID, "NASCAR_MODIFIED")

	// Вспомогательная функция: применяет результаты одной таблицы rr к нужному коду гонки.
	applyEventTable := func(rr EventTable, raceCode string, detail *EventDetailJSON, accumulateStages bool) {
		if len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			return
		}
		posCol := firstColIndex(rr.Headers, "Pos", "Pos.", "Fin")
		driverCol := colIndex(rr.Headers, "Driver")
		carCol := firstColIndex(rr.Headers, "No", "No.", "#", "Car")
		teamCol := colIndex(rr.Headers, "Team")
		manuCol := colIndex(rr.Headers, "Manufacturer")
		if manuCol < 0 {
			manuCol = colIndex(rr.Headers, "Chassis")
		}
		if manuCol < 0 {
			manuCol = colIndex(rr.Headers, "Make")
		}
		ptsCol := colIndex(rr.Headers, "Points")
		if ptsCol < 0 {
			ptsCol = colIndex(rr.Headers, "Pts")
		}
		if ptsCol < 0 {
			ptsCol = colIndex(rr.Headers, "Pts.")
		}
		if driverCol < 0 {
			return
		}

		// Очки стейджей считаем только там, где есть таблицы stage1/stage2 и accumulateStages = true.
		stagePointsByDriver := make(map[string]int)
		if accumulateStages && detail != nil && detail.Tables != nil {
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
					d := strings.TrimSpace(row[sDriverCol])
					if d == "" {
						continue
					}
					pts := 0
					if s := strings.TrimSpace(row[sPtsCol]); s != "" {
						for _, c := range s {
							if c >= '0' && c <= '9' {
								pts = pts*10 + int(c-'0')
							}
						}
					}
					stagePointsByDriver[d] += pts
				}
			}
		}

		for _, row := range rr.Rows {
			if driverCol >= len(row) {
				continue
			}
			driver := strings.TrimSpace(row[driverCol])
			// F1: нормализуем Carlos Sainz -> Carlos Sainz Jr.
			if strings.EqualFold(seriesID, "F1") && driver == "Carlos Sainz" {
				driver = "Carlos Sainz Jr."
			}
			if driver == "" {
				continue
			}
			carNum := ""
			if carCol >= 0 && carCol < len(row) {
				carNum = strings.TrimSpace(row[carCol])
			}
			rawPos := ""
			if posCol >= 0 && posCol < len(row) {
				rawPos = strings.TrimSpace(row[posCol])
			}
			team := ""
			if teamCol >= 0 && teamCol < len(row) {
				team = strings.TrimSpace(row[teamCol])
			}
			manu := ""
			if manuCol >= 0 && manuCol < len(row) {
				manu = strings.TrimSpace(row[manuCol])
			}
			if manu == "" && indyEngineByCar != nil && carNum != "" {
				if eng, ok := indyEngineByCar[carNum]; ok {
					manu = eng
				}
			}
			racePts := 0.0
			if ptsCol >= 0 && ptsCol < len(row) {
				racePts = parsePointsValue(row[ptsCol])
			}
			key := canonicalDriverKey(driver)
			if key == "" {
				key = driver
			}
			if byDriver[key] == nil {
				byDriver[key] = &accRow{driver: driver, car: carNum, team: team, manufacturer: manu, races: make(map[string]string)}
			}
			r := byDriver[key]
			if r.car == "" {
				r.car = carNum
			}
			if r.team == "" {
				r.team = team
			}
			if r.manufacturer == "" {
				r.manufacturer = manu
			}
			// В ячейку standings пишем ровно то, что было в колонке Pos
			// (включая специальные значения вроде Ret, DSQ, NC и т.п.).
			raceDisplay := rawPos
			r.races[raceCode] = raceDisplay
			r.points += racePts
			r.stages += stagePointsByDriver[driver]
		}
	}

	for _, ev := range events {
		if ev.Season != season {
			continue
		}
		// Выставочные гонки (например, Cook Out Clash) не должны попадать в общей зачёт.
		// Для Cup Series пропускаем события с индексом ..._0 (NASCAR_CUP_2026_0 и т.п.).
		if isExhibitionEvent(seriesID, ev.ID) {
			continue
		}
		// Для Cup дополнительно не учитываем события, которые ещё не прошли по календарю.
		if isCupSeries {
			if ev.StartDate != "" && ev.StartDate > today {
				continue
			}
		}
		if raceIdx >= len(raceOrder) {
			break
		}
		// Super Formula: один event может содержать две гонки (race.sessions).
		// В этом случае раскладываем все сессии последовательно по race_order (R1, R2, ...).
		if strings.EqualFold(seriesID, "SUPER_FORMULA") {
			if sessions, errSess := LoadEventRaceSessions(dataDir, ev.ID); errSess == nil && len(sessions) > 0 {
				var detail *EventDetailJSON
				if det, errDet := LoadEventDetail(dataDir, ev.ID); errDet == nil {
					detail = det
				}
				used := false
				for _, rs := range sessions {
					if raceIdx >= len(raceOrder) {
						break
					}
					if len(rs.Headers) == 0 || len(rs.Rows) == 0 {
						continue
					}
					raceCode := raceOrder[raceIdx]
					applyEventTable(EventTable{Headers: rs.Headers, Rows: rs.Rows}, raceCode, detail, false)
					completedRaces = append(completedRaces, raceCode)
					raceIdx++
					used = true
				}
				if used {
					continue
				}
			}
		}

		// F1 2025: спринт‑уикенд — выделяем две колонки (Sprint и основная гонка),
		// коды гонок в race_order: RnS и RnF.
		if isF1SprintSeason && eventHasSprintRaceSession(dataDir, ev.ID) && raceIdx+1 < len(raceOrder) {
			sessions, errSess := LoadEventRaceSessions(dataDir, ev.ID)
			if errSess == nil && len(sessions) > 0 {
				var sprintSess, featureSess *RaceSession
				for i := range sessions {
					titleLower := strings.ToLower(sessions[i].Title)
					if strings.Contains(titleLower, "sprint") {
						// Предпочитаем сессию, где явно указано "sprint race".
						if sprintSess == nil || strings.Contains(titleLower, "race") {
							sprintSess = &sessions[i]
						}
					} else if strings.Contains(titleLower, "race") || strings.Contains(titleLower, "grand prix") {
						if featureSess == nil {
							featureSess = &sessions[i]
						}
					}
				}

				// Основная гонка: либо отдельная сессия, либо таблица race_results.
				var mainTable EventTable
				var mainDetail *EventDetailJSON
				if featureSess != nil {
					mainTable = EventTable{Headers: featureSess.Headers, Rows: featureSess.Rows}
				} else {
					if detail, errDet := LoadEventDetail(dataDir, ev.ID); errDet == nil && detail != nil && detail.Tables != nil {
						if rr, ok := detail.Tables["race_results"]; ok && len(rr.Headers) > 0 && len(rr.Rows) > 0 {
							mainTable = rr
							mainDetail = detail
						} else if ra, okRace := detail.Tables["race"]; okRace && len(ra.Headers) > 0 && len(ra.Rows) > 0 {
							mainTable = ra
							mainDetail = detail
						}
					}
				}

				// Если нет надёжного сплита (нет спринта или основной гонки) — обрабатываем как обычный этап.
				if sprintSess != nil && len(mainTable.Headers) > 0 && len(mainTable.Rows) > 0 {
					sprintCode := raceOrder[raceIdx]
					featureCode := raceOrder[raceIdx+1]
					applyEventTable(EventTable{Headers: sprintSess.Headers, Rows: sprintSess.Rows}, sprintCode, nil, false)
					applyEventTable(mainTable, featureCode, mainDetail, false)
					completedRaces = append(completedRaces, sprintCode, featureCode)
					raceIdx += 2
					continue
				}
			}
		}

		raceCode := raceOrder[raceIdx]
		detail, err := LoadEventDetail(dataDir, ev.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		rr, ok := detail.Tables["race_results"]
		// Для сток‑кар серий (Cup/Xfinity/Truck/ARCA/Modified) допускаем формат,
		// когда полная таблица результатов гонки лежит в stage3, а race_results отсутствует.
		if (!ok || len(rr.Headers) == 0 || len(rr.Rows) == 0) && isStockCarSeries {
			if st3, okStage3 := detail.Tables["stage3"]; okStage3 && len(st3.Headers) > 0 && len(st3.Rows) > 0 {
				rr = st3
				ok = true
			}
		}
		// F1/F2/F3 и другие open-wheel серии: допускаем таблицу "race" или race.sessions.
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			if ra, okRace := detail.Tables["race"]; okRace && len(ra.Headers) > 0 && len(ra.Rows) > 0 {
				rr = ra
				ok = true
			}
		}
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			if sessions, errSess := LoadEventRaceSessions(dataDir, ev.ID); errSess == nil && len(sessions) > 0 {
				// Берём первую сессию как основную гонку (для F1 2025 это единственная "Race").
				rs := sessions[0]
				rr = EventTable{Headers: rs.Headers, Rows: rs.Rows}
				ok = len(rr.Headers) > 0 && len(rr.Rows) > 0
			}
		}
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			continue
		}
		// Только если у события есть полноценная таблица результатов гонки,
		// продвигаем индекс гонок и помечаем её как завершённую.
		raceIdx++
		completedRaces = append(completedRaces, raceCode)
		posCol := firstColIndex(rr.Headers, "Pos", "Pos.", "Fin")
		driverCol := colIndex(rr.Headers, "Driver")
		carCol := firstColIndex(rr.Headers, "No", "No.", "#", "Car")
		teamCol := colIndex(rr.Headers, "Team")
		manuCol := colIndex(rr.Headers, "Manufacturer")
		if manuCol < 0 {
			manuCol = colIndex(rr.Headers, "Chassis")
		}
		if manuCol < 0 {
			manuCol = colIndex(rr.Headers, "Make")
		}
		ptsCol := colIndex(rr.Headers, "Points")
		if ptsCol < 0 {
			ptsCol = colIndex(rr.Headers, "Pts")
		}
		if ptsCol < 0 {
			ptsCol = colIndex(rr.Headers, "Pts.")
		}
		statusCol := colIndex(rr.Headers, "Status")
		if statusCol < 0 {
			statusCol = colIndex(rr.Headers, "Reason")
		}
		if statusCol < 0 {
			statusCol = colIndex(rr.Headers, "Notes")
		}
		if driverCol < 0 {
			continue
		}
		stagePointsByDriver := make(map[string]int)
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
				d := strings.TrimSpace(row[sDriverCol])
				if d == "" {
					continue
				}
				pts := 0
				if s := strings.TrimSpace(row[sPtsCol]); s != "" {
					for _, c := range s {
						if c >= '0' && c <= '9' {
							pts = pts*10 + int(c-'0')
						}
					}
				}
				stagePointsByDriver[d] += pts
			}
		}
		for rowIdx, row := range rr.Rows {
			if driverCol >= len(row) {
				continue
			}
			driver := strings.TrimSpace(row[driverCol])
			// F1: нормализуем Carlos Sainz -> Carlos Sainz Jr.
			if strings.EqualFold(seriesID, "F1") && driver == "Carlos Sainz" {
				driver = "Carlos Sainz Jr."
			}
			if driver == "" {
				continue
			}
			carNum := ""
			if carCol >= 0 && carCol < len(row) {
				carNum = strings.TrimSpace(row[carCol])
			}
			rawPos := ""
			if posCol >= 0 && posCol < len(row) {
				rawPos = strings.TrimSpace(row[posCol])
			}
			status := ""
			if statusCol >= 0 && statusCol < len(row) {
				status = strings.TrimSpace(row[statusCol])
			}
			team := ""
			if teamCol >= 0 && teamCol < len(row) {
				team = strings.TrimSpace(row[teamCol])
			}
			manu := ""
			if manuCol >= 0 && manuCol < len(row) {
				manu = strings.TrimSpace(row[manuCol])
			}
			if manu == "" && indyEngineByCar != nil && carNum != "" {
				if eng, ok := indyEngineByCar[carNum]; ok {
					manu = eng
				}
			}
			racePts := 0.0
			if ptsCol >= 0 && ptsCol < len(row) {
				racePts = parsePointsValue(row[ptsCol])
			}
			key := canonicalDriverKey(driver)
			if key == "" {
				key = driver
			}
			if byDriver[key] == nil {
				byDriver[key] = &accRow{driver: driver, car: carNum, team: team, manufacturer: manu, races: make(map[string]string)}
			}
			r := byDriver[key]
			if r.car == "" {
				r.car = carNum
			}
			if r.team == "" {
				r.team = team
			}
			if r.manufacturer == "" {
				r.manufacturer = manu
			}
			// Нормализуем отображаемое значение позиции:
			// - пустой Pos + статус Did Not Qualify → DNQ
			// - NC → индекс строки (1‑based), чтобы можно было отличить нескольких NC
			raceDisplay := rawPos
			if raceDisplay == "" && statusCol >= 0 && strings.Contains(strings.ToLower(status), "did not qualify") {
				raceDisplay = "DNQ"
			} else if strings.EqualFold(strings.TrimSpace(rawPos), "NC") {
				raceDisplay = itoa(rowIdx + 1)
			}
			r.races[raceCode] = raceDisplay
			r.points += racePts
			r.stages += stagePointsByDriver[driver]
		}
		// Did Not Qualify: добавляем пилотов из таблицы did_not_qualify с пометкой DNQ по этой гонке
		if dnq, ok := detail.Tables["did_not_qualify"]; ok && len(dnq.Headers) > 0 && len(dnq.Rows) > 0 {
			dnqDriverCol := colIndex(dnq.Headers, "Driver")
			dnqTeamCol := colIndex(dnq.Headers, "Team")
			dnqManuCol := colIndex(dnq.Headers, "Manufacturer")
			// Для Modified и некоторых других серий шасси может быть в колонке "Chassis" или "Make".
			if dnqManuCol < 0 {
				dnqManuCol = colIndex(dnq.Headers, "Chassis")
			}
			if dnqManuCol < 0 {
				dnqManuCol = colIndex(dnq.Headers, "Make")
			}
			for _, row := range dnq.Rows {
				if dnqDriverCol < 0 || dnqDriverCol >= len(row) {
					continue
				}
				driver := strings.TrimSpace(row[dnqDriverCol])
				if driver == "" {
					continue
				}
				key := canonicalDriverKey(driver)
				if key == "" {
					key = driver
				}
				if byDriver[key] == nil {
					team := ""
					if dnqTeamCol >= 0 && dnqTeamCol < len(row) {
						team = strings.TrimSpace(row[dnqTeamCol])
					}
					manu := ""
					if dnqManuCol >= 0 && dnqManuCol < len(row) {
						manu = strings.TrimSpace(row[dnqManuCol])
					}
					byDriver[key] = &accRow{driver: driver, team: team, manufacturer: manu, races: make(map[string]string)}
				}
				r := byDriver[key]
				if _, has := r.races[raceCode]; !has {
					r.races[raceCode] = "DNQ"
				}
			}
		}
	}
	if len(byDriver) == 0 {
		base.CompletedRaces = completedRaces
		SplitBaseIneligible(base)
		return base, nil
	}
	rows := make([]StandingRow, 0, len(byDriver))
	for _, r := range byDriver {
		rows = append(rows, StandingRow{
			Car:          r.car,
			Driver:       r.driver,
			Team:         r.team,
			Manufacturer: r.manufacturer,
			Races:        r.races,
			Points:       formatPointsValue(r.points),
			Stages:       itoa(r.stages),
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		pi := parsePointsValue(rows[i].Points)
		pj := parsePointsValue(rows[j].Points)
		if pi != pj {
			return pi > pj
		}
		return rows[i].Driver < rows[j].Driver
	})
	// Разделяем на eligible (без (i)) и ineligible (с (i) в имени)
	var eligible, ineligible []StandingRow
	for _, r := range rows {
		if strings.Contains(r.Driver, "(i)") {
			ineligible = append(ineligible, r)
		} else {
			eligible = append(eligible, r)
		}
	}
	for i := range eligible {
		eligible[i].Pos = i + 1
	}
	sort.Slice(ineligible, func(i, j int) bool {
		pi := parsePointsValue(ineligible[i].Points)
		pj := parsePointsValue(ineligible[j].Points)
		if pi != pj {
			return pi > pj
		}
		return ineligible[i].Driver < ineligible[j].Driver
	})
	for i := range ineligible {
		ineligible[i].Pos = i + 1
	}
	// Сохраняем EventNames из базового standings (если были), чтобы фронтенд мог
	// показать подписи этапов (AUS, CHI, JAP, ...) в шапке таблицы.
	return &StandingsData{
		RaceOrder:      raceOrder,
		EventNames:     base.EventNames,
		CompletedRaces: completedRaces,
		Rows:           eligible,
		Ineligible:     ineligible,
	}, nil
}

// EnrichStagesFromEvents заполняет Stages в строках standings из таблиц stage1/stage2 событий (по имени пилота).
func EnrichStagesFromEvents(dataDir string, seriesID string, data *StandingsData) {
	if data == nil || len(data.Rows) == 0 {
		return
	}
	events, err := LoadEvents(dataDir, seriesID)
	if err != nil || len(events) == 0 {
		return
	}
	stagePointsByDriver := make(map[string]int)
	for _, ev := range events {
		if isExhibitionEvent(seriesID, ev.ID) {
			continue
		}
		detail, err := LoadEventDetail(dataDir, ev.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
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
				d := strings.TrimSpace(row[sDriverCol])
				if d == "" {
					continue
				}
				pts := 0
				if s := strings.TrimSpace(row[sPtsCol]); s != "" {
					for _, c := range s {
						if c >= '0' && c <= '9' {
							pts = pts*10 + int(c-'0')
						}
					}
				}
				stagePointsByDriver[d] += pts
			}
		}
	}
	for i := range data.Rows {
		driver := strings.TrimSpace(data.Rows[i].Driver)
		sum := stagePointsByDriver[driver]
		data.Rows[i].Stages = itoa(sum)
	}
	for i := range data.Ineligible {
		driver := strings.TrimSpace(data.Ineligible[i].Driver)
		sum := stagePointsByDriver[driver]
		data.Ineligible[i].Stages = itoa(sum)
	}
}

// SupercarsCarToCanonical приводит номер машины Supercars к каноническому виду: 800 (Sydney) → 8.
func SupercarsCarToCanonical(car string) string {
	if strings.TrimSpace(car) == "800" {
		return "8"
	}
	return car
}

// MergeSupercarsCar800Into8 объединяет строки с номерами 800 и 8 для одного пилота в одну строку с Car "8".
func MergeSupercarsCar800Into8(data *StandingsData) {
	if data == nil || len(data.Rows) == 0 {
		return
	}
	// Сначала приводим 800 → 8
	for i := range data.Rows {
		if strings.TrimSpace(data.Rows[i].Car) == "800" {
			data.Rows[i].Car = "8"
		}
	}
	// Группируем по (Driver, Car) и сливаем строки с одинаковым пилотом и номером 8
	type key struct {
		driver string
		car    string
	}
	merged := make(map[key]*StandingRow)
	var order []key
	for i := range data.Rows {
		r := &data.Rows[i]
		k := key{driver: strings.TrimSpace(r.Driver), car: strings.TrimSpace(r.Car)}
		if existing, ok := merged[k]; ok {
			if existing.Races == nil {
				existing.Races = make(map[string]string)
			}
			for code, v := range r.Races {
				if v != "" && v != "—" && v != "-" {
					existing.Races[code] = v
				}
			}
			existing.Points = itoa(atoi(existing.Points) + atoi(r.Points))
			if r.Team != "" {
				existing.Team = r.Team
			}
			if r.Manufacturer != "" {
				existing.Manufacturer = r.Manufacturer
			}
			continue
		}
		r2 := *r
		r2.Races = make(map[string]string)
		for code, v := range r.Races {
			r2.Races[code] = v
		}
		merged[k] = &r2
		order = append(order, k)
	}
	var newRows []StandingRow
	for _, k := range order {
		newRows = append(newRows, *merged[k])
	}
	sort.Slice(newRows, func(i, j int) bool {
		pi, pj := atoi(newRows[i].Points), atoi(newRows[j].Points)
		if pi != pj {
			return pi > pj
		}
		return newRows[i].Driver < newRows[j].Driver
	})
	for i := range newRows {
		newRows[i].Pos = i + 1
	}
	data.Rows = newRows
}

// BuildSupercarsStandingsFromFiles собирает турнирную таблицу Supercars только из файлов (Sydney + Melbourne),
// когда БД не используется или пуста. Использует data/standings/supercars.json, events/supercars_2026_1.json и supercars_2026_4.json.
func BuildSupercarsStandingsFromFiles(dataDir string) (*StandingsData, error) {
	const seriesID = "supercars"
	supercarsOrder := []string{"SMP1", "SMP2", "SMP3", "MLB4", "MLB5", "MLB6", "MLB7"}
	base, err := LoadStandings(dataDir, seriesID)
	if err != nil || base == nil {
		base = &StandingsData{RaceOrder: supercarsOrder, CompletedRaces: []string{}, Rows: []StandingRow{}}
	}
	if base != nil && len(base.Rows) > 0 {
		MergeSupercarsCar800Into8(base)
	}
	if len(base.RaceOrder) != 7 {
		base.RaceOrder = supercarsOrder
	}

	teams, _ := LoadTeams(dataDir, seriesID)
	driverByNo := make(map[string]string)
	teamByNo := make(map[string]string)
	manufacturerByNo := make(map[string]string)
	if teams != nil {
		for _, t := range teams.Teams {
			no := strings.TrimSpace(t.Number)
			if no == "" {
				continue
			}
			if t.Driver != "" {
				driverByNo[no] = strings.TrimSpace(t.Driver)
			}
			if t.Team != "" {
				teamByNo[no] = strings.TrimSpace(t.Team)
			}
			if t.Manufacturer != "" {
				manufacturerByNo[no] = strings.TrimSpace(t.Manufacturer)
			}
		}
	}

	sessions, err := LoadEventRaceSessions(dataDir, "SUPERCARS_2026_1")
	if err != nil || len(sessions) == 0 {
		EnrichSupercarsStandingsWithMelbourne(dataDir, base)
		return base, nil
	}

	type acc struct {
		driver string
		team   string
		manu   string
		races  map[string]string
		points int
	}
	byCar := make(map[string]*acc)
	smpCodes := []string{"SMP1", "SMP2", "SMP3"}
	for j := 0; j < 3 && j < len(sessions); j++ {
		sess := &sessions[j]
		colPos := firstColIndex(sess.Headers, "Pos", "Fin")
		colNo := firstColIndex(sess.Headers, "No", "No.", "#", "Car")
		colDriver := firstColIndex(sess.Headers, "Driver")
		colTeam := firstColIndex(sess.Headers, "Team")
		colPts := firstColIndex(sess.Headers, "Pts", "Points")
		if colNo < 0 {
			continue
		}
		for _, row := range sess.Rows {
			if colNo >= len(row) {
				continue
			}
			car := SupercarsCarToCanonical(strings.TrimSpace(row[colNo]))
			if car == "" {
				continue
			}
			if byCar[car] == nil {
				drv := ""
				if colDriver >= 0 && colDriver < len(row) {
					drv = strings.TrimSpace(row[colDriver])
				}
				if drv == "" {
					drv = driverByNo[car]
				}
				team := teamByNo[car]
				if team == "" && colTeam >= 0 && colTeam < len(row) {
					team = strings.TrimSpace(row[colTeam])
				}
				manu := manufacturerByNo[car]
				byCar[car] = &acc{driver: drv, team: team, manu: manu, races: make(map[string]string)}
			}
			a := byCar[car]
			posStr := "—"
			if colPos >= 0 && colPos < len(row) {
				posStr = strings.TrimSpace(row[colPos])
			}
			if posStr == "" {
				posStr = "—"
			}
			a.races[smpCodes[j]] = posStr
			if colPts >= 0 && colPts < len(row) {
				s := strings.TrimSpace(row[colPts])
				s = strings.TrimPrefix(s, "+")
				a.points += atoi(s)
			}
		}
	}

	var rows []StandingRow
	for car, a := range byCar {
		rows = append(rows, StandingRow{
			Car:          car,
			Driver:       a.driver,
			Team:         a.team,
			Manufacturer: a.manu,
			Points:       itoa(a.points),
			Races:        a.races,
		})
	}

	sort.Slice(rows, func(i, j int) bool {
		pi, pj := atoi(rows[i].Points), atoi(rows[j].Points)
		if pi != pj {
			return pi > pj
		}
		return rows[i].Driver < rows[j].Driver
	})
	for i := range rows {
		rows[i].Pos = i + 1
	}

	base.Rows = rows
	nWithData := len(sessions)
	if nWithData > 3 {
		nWithData = 3
	}
	base.CompletedRaces = make([]string, 0, 7)
	for i := 0; i < nWithData; i++ {
		base.CompletedRaces = append(base.CompletedRaces, smpCodes[i])
	}
	EnrichSupercarsStandingsWithMelbourne(dataDir, base)
	return base, nil
}

// NormalizeSupercarsStandingsToSeven приводит турнирную таблицу Supercars к 7 колонкам: SMP1–SMP3 (Sydney), MLB4–MLB7 (Melbourne и далее).
func NormalizeSupercarsStandingsToSeven(data *StandingsData) {
	if data == nil || len(data.RaceOrder) >= 7 {
		return
	}
	n := len(data.RaceOrder)
	if n == 0 {
		return
	}
	const supercarsCols = 7
	supercarsRaceCodes := []string{"SMP1", "SMP2", "SMP3", "MLB4", "MLB5", "MLB6", "MLB7"}
	newOrder := make([]string, supercarsCols)
	copy(newOrder, supercarsRaceCodes)
	eventNames := data.EventNames
	if len(eventNames) < supercarsCols {
		last := ""
		if len(eventNames) > 0 {
			last = eventNames[len(eventNames)-1]
		}
		for len(eventNames) < supercarsCols {
			eventNames = append(eventNames, last)
		}
		data.EventNames = eventNames
	}
	for i := range data.Rows {
		if data.Rows[i].Races == nil {
			data.Rows[i].Races = make(map[string]string)
		}
		newRaces := make(map[string]string)
		for j := 0; j < supercarsCols; j++ {
			if j < n {
				if v := data.Rows[i].Races[data.RaceOrder[j]]; v != "" {
					newRaces[newOrder[j]] = v
				}
			}
		}
		data.Rows[i].Races = newRaces
	}
	data.RaceOrder = newOrder
	if len(data.CompletedRaces) <= n {
		data.CompletedRaces = make([]string, 0, supercarsCols)
		for i := 0; i < n && i < supercarsCols; i++ {
			data.CompletedRaces = append(data.CompletedRaces, newOrder[i])
		}
	}
}

// EnrichSupercarsStandingsWithMelbourne добавляет гонки Melbourne (MLB4–MLB7) из data/events/supercars_2026_4.json,
// если в data только Sydney (3 колонки) или уже 7 колонок (SMP1–SMP3 + MLB4–MLB7), но MLB4–MLB7 пустые.
// Не перезаписывает данные из БД: при уже заполненном MLB4 (у любой строки) функция сразу выходит.
func EnrichSupercarsStandingsWithMelbourne(dataDir string, data *StandingsData) {
	if data == nil || len(data.Rows) == 0 {
		return
	}
	// Уже есть 7 колонок (нормализация), но MLB4–MLB7 пустые — заполняем только из файла
	alreadySeven := len(data.RaceOrder) == 7
	if !alreadySeven && len(data.RaceOrder) != 3 {
		return
	}
	if alreadySeven {
		// Не трогаем данные из БД: если MLB4 уже заполнен, обогащение не выполняем.
		if data.Rows[0].Races != nil && data.Rows[0].Races["MLB4"] != "" && data.Rows[0].Races["MLB4"] != "—" {
			return
		}
	}
	sessions, err := LoadEventRaceSessions(dataDir, "SUPERCARS_2026_4")
	if err != nil {
		log.Printf("[Supercars] EnrichSupercarsStandingsWithMelbourne: load file failed: %v", err)
		return
	}
	if len(sessions) < 3 {
		log.Printf("[Supercars] EnrichSupercarsStandingsWithMelbourne: need at least 3 sessions, got %d", len(sessions))
		return
	}
	// До 4 сессий Melbourne (Race 4, 5, 6, 7) → MLB4, MLB5, MLB6, MLB7
	nMelbourne := 4
	if nMelbourne > len(sessions) {
		nMelbourne = len(sessions)
	}
	type res struct {
		pos string
		pts int
	}
	melbourne := make([]map[string]res, nMelbourne)
	for i := 0; i < nMelbourne && i < len(sessions); i++ {
		sess := &sessions[i]
		colPos := firstColIndex(sess.Headers, "Pos", "Fin")
		colNo := firstColIndex(sess.Headers, "No", "No.", "#", "Car")
		colPts := firstColIndex(sess.Headers, "Pts", "Points")
		if colNo < 0 {
			continue
		}
		byCar := make(map[string]res)
		for _, row := range sess.Rows {
			if colNo >= len(row) {
				continue
			}
			car := SupercarsCarToCanonical(strings.TrimSpace(row[colNo]))
			if car == "" {
				continue
			}
			posStr := ""
			if colPos >= 0 && colPos < len(row) {
				posStr = strings.TrimSpace(row[colPos])
			}
			if posStr == "" {
				posStr = "—"
			}
			if strings.EqualFold(posStr, "NC") {
				posStr = "NC"
			}
			pts := 0
			if colPts >= 0 && colPts < len(row) {
				s := strings.TrimSpace(row[colPts])
				s = strings.TrimPrefix(s, "+")
				pts = atoi(s)
			}
			byCar[car] = res{pos: posStr, pts: pts}
		}
		melbourne[i] = byCar
	}
	newCodes := []string{"MLB4", "MLB5", "MLB6", "MLB7"}
	if !alreadySeven {
		eventName := "Melbourne"
		for k := 0; k < 4; k++ {
			data.RaceOrder = append(data.RaceOrder, newCodes[k])
		}
		if len(data.EventNames) == 3 {
			data.EventNames = append(data.EventNames, eventName, eventName, eventName, eventName)
		}
		if len(data.CompletedRaces) == 3 {
			for k := 0; k < nMelbourne; k++ {
				data.CompletedRaces = append(data.CompletedRaces, newCodes[k])
			}
		}
	} else if len(data.CompletedRaces) == 3 {
		for k := 0; k < nMelbourne; k++ {
			data.CompletedRaces = append(data.CompletedRaces, newCodes[k])
		}
	}
	for i := range data.Rows {
		car := strings.TrimSpace(data.Rows[i].Car)
		canonCar := SupercarsCarToCanonical(car)
		if data.Rows[i].Races == nil {
			data.Rows[i].Races = make(map[string]string)
		}
		curPts := atoi(data.Rows[i].Points)
		for j, byCar := range melbourne {
			if byCar == nil {
				continue
			}
			r, ok := byCar[canonCar]
			if !ok {
				data.Rows[i].Races[newCodes[j]] = "—"
				continue
			}
			data.Rows[i].Races[newCodes[j]] = r.pos
			curPts += r.pts
		}
		for j := len(melbourne); j < 4; j++ {
			if data.Rows[i].Races[newCodes[j]] == "" {
				data.Rows[i].Races[newCodes[j]] = "—"
			}
		}
		data.Rows[i].Points = itoa(curPts)
	}
	// Пересортировать по очкам
	sort.Slice(data.Rows, func(i, j int) bool {
		pi, pj := atoi(data.Rows[i].Points), atoi(data.Rows[j].Points)
		if pi != pj {
			return pi > pj
		}
		return data.Rows[i].Driver < data.Rows[j].Driver
	})
	for i := range data.Rows {
		data.Rows[i].Pos = i + 1
	}
}
