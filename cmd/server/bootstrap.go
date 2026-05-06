package main

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/internal/tableutil"
	"github.com/vX8q/tga/models"
)

// bootstrapStoreFromFiles заполняет и обновляет хранилище данными из JSON при каждом запуске сервера.
// Серии и события — upsert из config и data/schedules; результаты гонок — переимпорт из data/events.
func bootstrapStoreFromFiles(st store.Store, dataDir string) error {
	if st == nil {
		return nil
	}
	ctx := context.Background()
	return st.RunInTransaction(ctx, func(tx store.Store) error {
		// 1) Сохраняем в БД все серии из config.Championships.
		for _, c := range config.Championships {
			series := &models.Series{
				ID:      c.ID,
				Name:    c.Name,
				Season:  c.Season,
				Type:    string(c.Type),
				Country: c.Country,
			}
			if err := tx.UpsertSeries(ctx, series); err != nil {
				return err
			}
		}

		// 2) Для всех чемпионатов загружаем расписание из data/schedules/*.json и сохраняем события в БД.
		for _, c := range config.Championships {
			dataID := config.DataSeriesID(c.ID)
			events, err := schedulefile.LoadEvents(dataDir, dataID)
			if err != nil {
				return err
			}
			for _, e := range events {
				ev, err := schedulefile.EventToModel(e)
				if err != nil {
					return err
				}
				if err := tx.UpsertEvent(ctx, ev); err != nil {
					return err
				}
			}
		}

		// 3) Серии с подробными результатами гонок в JSON: импортируем результаты и стейджи в БД.
		for _, c := range config.Championships {
			// Сток-кар серии (NASCAR/ARCA/etc.) — формат race_results. Supercars туда же, но гонки подтягиваются из race.sessions ниже.
			if c.Type == config.StockCarRacing || strings.EqualFold(c.ID, "SUPERCARS") {
				if err := importStockCarSeries(ctx, tx, dataDir, c.ID); err != nil {
					return err
				}
			}
			// Supercars: результаты из tables.race.sessions (Race 1, Race 2, … по каждому этапу).
			if strings.EqualFold(c.ID, "SUPERCARS") {
				if err := importSupercarsFromRaceSessions(ctx, tx, dataDir, c.ID); err != nil {
					return err
				}
			}
			// F1, F2, F3: результаты из tables.race (sessions или одна таблица).
			if strings.EqualFold(c.ID, "F1") || strings.EqualFold(c.ID, "F2") || strings.EqualFold(c.ID, "F3") {
				if err := importOpenwheelSeries(ctx, tx, dataDir, c.ID); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// importStockCarSeries загружает расписание и подробные результаты сток-кар серии из JSON
// и наполняет таблицы events, races, results, stage_results.
// seriesID — ID чемпионата (например NASCAR_CUP); для загрузки файлов используется config.DataSeriesID.
func importStockCarSeries(ctx context.Context, st store.Store, dataDir, seriesID string) error {
	dataID := config.DataSeriesID(seriesID)
	events, err := schedulefile.LoadEvents(dataDir, dataID)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	for _, e := range events {
		ev, err := schedulefile.EventToModel(e)
		if err != nil {
			return err
		}
		if err := st.UpsertEvent(ctx, ev); err != nil {
			return err
		}

		// 2) Детали события: таблицы гонок и стейджей
		detail, err := schedulefile.LoadEventDetail(dataDir, e.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		rr, ok := detail.Tables["race_results"]
		if !ok || len(rr.Headers) == 0 || len(rr.Rows) == 0 {
			continue
		}

		// 3) Гонка
		raceID := e.ID + ":RACE"
		raceLaps := maxIntColumn(rr.Headers, rr.Rows, []string{"Laps"})
		race := &models.Race{
			ID:         raceID,
			EventID:    e.ID,
			SeriesID:   e.SeriesID,
			Season:     e.Season,
			Name:       e.Name,
			ScheduleAt: ev.StartDate,
			Laps:      raceLaps,
			Distance:  detail.Distance,
			Status:    "",
		}
		if err := st.UpsertRace(ctx, race); err != nil {
			return err
		}

		// 4) Результаты гонки
		colPos := firstHeaderIndex(rr.Headers, "Pos", "Fin")
		colGrid := firstHeaderIndex(rr.Headers, "Grid", "St", "Start", "Started")
		colNo := firstHeaderIndex(rr.Headers, "No", "#", "Car")
		colDriver := firstHeaderIndex(rr.Headers, "Driver")
		colTeam := firstHeaderIndex(rr.Headers, "Team")
		colManu := firstHeaderIndex(rr.Headers, "Manufacturer", "Chassis", "Make")
		colLaps := firstHeaderIndex(rr.Headers, "Laps")
		colLed := firstHeaderIndex(rr.Headers, "Led", "Laps Led")
		colStatus := firstHeaderIndex(rr.Headers, "Status", "Reason", "Notes")
		colPts := firstHeaderIndex(rr.Headers, "Points", "Pts")

		if colDriver < 0 {
			continue
		}

		for _, row := range rr.Rows {
			if colDriver >= len(row) {
				continue
			}
			driverName := strings.TrimSpace(row[colDriver])
			if driverName == "" {
				continue
			}
			carNumber := valueOrEmpty(row, colNo)
			teamName := valueOrEmpty(row, colTeam)
			manufacturer := valueOrEmpty(row, colManu)
			status := valueOrEmpty(row, colStatus)

			carForDriverID := carNumber
			if strings.EqualFold(seriesID, "SUPERCARS") {
				carForDriverID = schedulefile.SupercarsCarToCanonical(carNumber)
			}
			driverID := driverutil.MakeDriverID(seriesID, driverName, carForDriverID)
			teamID := makeTeamID(seriesID, teamName)

			if err := st.UpsertDriver(ctx, &models.Driver{
				ID:        driverID,
				Name:      driverName,
				ShortName: "",
				Number:    carForDriverID,
			}); err != nil {
				return err
			}
			if teamName != "" {
				if err := st.UpsertTeam(ctx, &models.Team{
					ID:      teamID,
					Name:    teamName,
					Country: "",
					Car:     manufacturer,
				}); err != nil {
					return err
				}
			}

			pos := atoiSafe(valueOrEmpty(row, colPos))
			grid := atoiSafe(valueOrEmpty(row, colGrid))
			laps := atoiSafe(valueOrEmpty(row, colLaps))
			lapsLed := 0
			if colLed >= 0 {
				lapsLed = atoiSafe(valueOrEmpty(row, colLed))
			}
			points := float64(atoiSafe(valueOrEmpty(row, colPts)))

			resID := raceID + ":" + driverID
			if carNumber != "" {
				resID = raceID + ":" + carNumber
			}

			if err := st.UpsertResult(ctx, &models.Result{
				ID:           resID,
				RaceID:       raceID,
				DriverID:     driverID,
				TeamID:       teamID,
				CarNumber:    carNumber,
				Position:     pos,
				GridPosition: grid,
				Laps:         laps,
				LapsLed:      lapsLed,
				Status:       status,
				Points:       points,
			}); err != nil {
				return err
			}
		}

		// 5) Стейджи (stage_1 / stage1, stage_2 / stage2)
		for stageNo := 1; stageNo <= 2; stageNo++ {
			table, ok := schedulefile.StageN(detail.Tables, stageNo)
			if !ok {
				continue
			}
			colPosS := firstHeaderIndex(table.Headers, "Pos", "Fin")
			colNoS := firstHeaderIndex(table.Headers, "No", "#", "Car")
			colDriverS := firstHeaderIndex(table.Headers, "Driver")
			colTeamS := firstHeaderIndex(table.Headers, "Team")
			colManuS := firstHeaderIndex(table.Headers, "Manufacturer", "Chassis", "Make")
			colLapsS := firstHeaderIndex(table.Headers, "Laps")
			colPtsS := firstHeaderIndex(table.Headers, "Points", "Pts")
			colStatusS := firstHeaderIndex(table.Headers, "Status", "Reason", "Notes")

			if colDriverS < 0 {
				continue
			}

			for _, row := range table.Rows {
				if colDriverS >= len(row) {
					continue
				}
				driverName := strings.TrimSpace(row[colDriverS])
				if driverName == "" {
					continue
				}
				carNumber := valueOrEmpty(row, colNoS)
				teamName := valueOrEmpty(row, colTeamS)
				manufacturer := valueOrEmpty(row, colManuS)
				status := valueOrEmpty(row, colStatusS)

				carForDriverID := carNumber
				if strings.EqualFold(seriesID, "SUPERCARS") {
					carForDriverID = schedulefile.SupercarsCarToCanonical(carNumber)
				}
				driverID := driverutil.MakeDriverID(seriesID, driverName, carForDriverID)
				teamID := makeTeamID(seriesID, teamName)

				if err := st.UpsertDriver(ctx, &models.Driver{
					ID:        driverID,
					Name:      driverName,
					ShortName: "",
					Number:    carForDriverID,
				}); err != nil {
					return err
				}
				if teamName != "" {
					if err := st.UpsertTeam(ctx, &models.Team{
						ID:      teamID,
						Name:    teamName,
						Country: "",
						Car:     manufacturer,
					}); err != nil {
						return err
					}
				}

				pos := atoiSafe(valueOrEmpty(row, colPosS))
				laps := atoiSafe(valueOrEmpty(row, colLapsS))
				points := atoiSafe(valueOrEmpty(row, colPtsS))

				stageID := raceID + ":S" + strconv.Itoa(stageNo) + ":" + driverID

				if err := st.UpsertStageResult(ctx, &models.StageResult{
					ID:        stageID,
					RaceID:    raceID,
					SeriesID:  e.SeriesID,
					Season:    e.Season,
					StageNo:   stageNo,
					DriverID:  driverID,
					TeamID:    teamID,
					CarNumber: carNumber,
					Position:  pos,
					Laps:      laps,
					Status:    status,
					Points:    points,
				}); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// importSupercarsFromRaceSessions загружает результаты Supercars из JSON (tables.race.sessions: Race 1, Race 2, …).
func importSupercarsFromRaceSessions(ctx context.Context, st store.Store, dataDir, seriesID string) error {
	dataID := config.DataSeriesID(seriesID)
	events, err := schedulefile.LoadEvents(dataDir, dataID)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}
	const dateLayout = "2006-01-02"
	for _, e := range events {
		if e.Season != config.CurrentSeason {
			continue
		}
		ev, err := schedulefile.EventToModel(e)
		if err != nil {
			continue
		}
		sessions, err := schedulefile.LoadEventRaceSessions(dataDir, e.ID)
		if err != nil || len(sessions) == 0 {
			continue
		}
		// Стартовые решётки Starting Grid — Race 1..7 для расчёта avg_start в статистике.
		gridByRace, _ := schedulefile.LoadSupercarsStartingGridByRace(dataDir, e.ID)
		scheduleAt := ev.StartDate
		if scheduleAt.IsZero() {
			if t, err := time.Parse(dateLayout, e.StartDate); err == nil {
				scheduleAt = t
			}
		}
		for sessIdx, sess := range sessions {
			raceID := e.ID + ":R" + strconv.Itoa(sessIdx+1)
			raceName := sess.Title
			if raceName == "" {
				raceName = "Race " + strconv.Itoa(sessIdx+1)
			}
			race := &models.Race{
				ID:         raceID,
				EventID:    e.ID,
				SeriesID:   e.SeriesID,
				Season:     e.Season,
				Name:       raceName,
				ScheduleAt: scheduleAt,
				Laps:       0,
				Distance:   "",
				Status:     "",
			}
			if err := st.UpsertRace(ctx, race); err != nil {
				return err
			}
			colPos := firstHeaderIndex(sess.Headers, "Pos", "Fin")
			colNo := firstHeaderIndex(sess.Headers, "No", "No.", "#", "Car")
			colDriver := firstHeaderIndex(sess.Headers, "Driver")
			colTeam := firstHeaderIndex(sess.Headers, "Team")
			colPts := firstHeaderIndex(sess.Headers, "Points", "Pts", "Pts.")
			if colDriver < 0 {
				continue
			}
			for rowIdx, row := range sess.Rows {
				if colDriver >= len(row) {
					continue
				}
				driverName := strings.TrimSpace(row[colDriver])
				if driverName == "" {
					continue
				}
				carNumber := valueOrEmpty(row, colNo)
				teamName := valueOrEmpty(row, colTeam)
				carForDriverID := carNumber
				if strings.EqualFold(seriesID, "SUPERCARS") {
					carForDriverID = schedulefile.SupercarsCarToCanonical(carNumber)
				}
				driverID := driverutil.MakeDriverID(seriesID, driverName, carForDriverID)
				teamID := makeTeamID(seriesID, teamName)
				if err := st.UpsertDriver(ctx, &models.Driver{
					ID:        driverID,
					Name:      driverName,
					ShortName: "",
					Number:    carForDriverID,
				}); err != nil {
					return err
				}
				if teamName != "" {
					if err := st.UpsertTeam(ctx, &models.Team{
						ID:      teamID,
						Name:    teamName,
						Country: "",
						Car:     "",
					}); err != nil {
						return err
					}
				}
				posStr := valueOrEmpty(row, colPos)
				pos := atoiSafe(posStr)
				if pos <= 0 && (strings.EqualFold(posStr, "DNF") || posStr == "") {
					pos = rowIdx + 1
				}
				ptsStr := valueOrEmpty(row, colPts)
				points := float64(atoiSafe(strings.TrimPrefix(strings.TrimSpace(ptsStr), "+")))
				resID := raceID + ":" + driverID
				if carNumber != "" {
					resID = raceID + ":" + carNumber
				}
				status := ""
				if strings.EqualFold(posStr, "DNF") {
					status = "DNF"
				}
				gridPos := 0
				if byCar := gridByRace[sessIdx+1]; byCar != nil {
					gridPos = byCar[carForDriverID]
				}
				if err := st.UpsertResult(ctx, &models.Result{
					ID:           resID,
					RaceID:       raceID,
					DriverID:     driverID,
					TeamID:       teamID,
					CarNumber:    carNumber,
					Position:     pos,
					GridPosition: gridPos,
					Laps:         0,
					LapsLed:      0,
					Status:       status,
					Points:       points,
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// importOpenwheelSeries загружает результаты F1/F2/F3 из JSON (tables.race.sessions или tables.race с headers/rows).
func importOpenwheelSeries(ctx context.Context, st store.Store, dataDir, seriesID string) error {
	dataID := config.DataSeriesID(seriesID)
	events, err := schedulefile.LoadEvents(dataDir, dataID)
	if err != nil || len(events) == 0 {
		return err
	}
	const dateLayout = "2006-01-02"
	for _, e := range events {
		// По умолчанию импортируем только текущий сезон (config.CurrentSeason),
		// но для F1 дополнительно тянем и 2025 год, чтобы историческая страница /season/f1-2025
		// строилась по данным из БД.
		if e.Season != config.CurrentSeason {
			if !(strings.EqualFold(seriesID, "F1") && e.Season == "2025") {
				continue
			}
		}
		ev, err := schedulefile.EventToModel(e)
		if err != nil {
			continue
		}
		sessions, err := schedulefile.LoadEventRaceSessions(dataDir, e.ID)
		if err != nil || len(sessions) == 0 {
			continue
		}
		entryList, _ := schedulefile.LoadEventEntryList(dataDir, e.ID)
		scheduleAt := ev.StartDate
		if scheduleAt.IsZero() {
			if t, err := time.Parse(dateLayout, e.StartDate); err == nil {
				scheduleAt = t
			}
		}
		for _, sess := range sessions {
			raceSuffix := ":FEATURE"
			if strings.EqualFold(seriesID, "F1") {
				raceSuffix = ":RACE"
			} else if strings.Contains(strings.ToUpper(sess.Title), "SPRINT") {
				raceSuffix = ":SPRINT"
			}
			raceID := e.ID + raceSuffix
			raceName := sess.Title
			if raceName == "" {
				raceName = raceSuffix[1:]
			}
			race := &models.Race{
				ID:         raceID,
				EventID:    e.ID,
				SeriesID:   e.SeriesID,
				Season:     e.Season,
				Name:       raceName,
				ScheduleAt: scheduleAt,
				Laps:       0,
				Distance:   "",
				Status:     "",
			}
			if err := st.UpsertRace(ctx, race); err != nil {
				return err
			}
			colPos := firstHeaderIndex(sess.Headers, "Pos", "Fin")
			colNo := firstHeaderIndex(sess.Headers, "No", "No.", "#", "Car")
			colDriver := firstHeaderIndex(sess.Headers, "Driver")
			colTeam := firstHeaderIndex(sess.Headers, "Team", "Constructor")
			colPts := firstHeaderIndex(sess.Headers, "Points", "Pts", "Pts.")
			colLaps := firstHeaderIndex(sess.Headers, "Laps")
			colGrid := firstHeaderIndex(sess.Headers, "Grid")
			colLapsLed := firstHeaderIndex(sess.Headers, "Laps Led", "Laps led")
			colBestLap := firstHeaderIndex(sess.Headers, "Best Lap", "Best lap")
			if colDriver < 0 {
				continue
			}
			for rowIdx, row := range sess.Rows {
				if colDriver >= len(row) {
					continue
				}
				driverName := strings.TrimSpace(row[colDriver])
				if driverName == "" {
					continue
				}
				// Нормализация проблемных имён для единообразия, чтобы избежать дублей
				if strings.EqualFold(seriesID, "F1") && driverName == "Carlos Sainz" {
					driverName = "Carlos Sainz Jr."
				}
				carNumber := valueOrEmpty(row, colNo)
				teamName := valueOrEmpty(row, colTeam)
				// F2/F3: по entry_list приводим "M. Shin"/"W. Shin" к одному пилоту (Michael Shin) по номеру машины
				if canonical, ok := entryList[carNumber]; ok && canonical != "" {
					driverName = canonical
				}
				driverID := driverutil.MakeDriverID(seriesID, driverName, carNumber)
				teamID := makeTeamID(seriesID, teamName)
				if err := st.UpsertDriver(ctx, &models.Driver{
					ID:        driverID,
					Name:      driverName,
					ShortName: "",
					Number:    carNumber,
				}); err != nil {
					return err
				}
				if teamName != "" {
					if err := st.UpsertTeam(ctx, &models.Team{
						ID:      teamID,
						Name:    teamName,
						Country: "",
						Car:     "",
					}); err != nil {
						return err
					}
				}
				posStr := valueOrEmpty(row, colPos)
				pos := atoiSafe(posStr)
				if pos <= 0 && (strings.EqualFold(posStr, "DNF") || posStr == "") {
					pos = rowIdx + 1
				}
				points := float64(atoiSafe(valueOrEmpty(row, colPts)))
				resID := raceID + ":" + driverID
				if carNumber != "" {
					resID = raceID + ":" + carNumber
				}
				status := ""
				switch strings.ToUpper(strings.TrimSpace(posStr)) {
				case "DNF":
					status = "DNF"
				case "DNS":
					status = "DNS"
				case "RET", "NC":
					status = posStr
				}
				laps := atoiSafe(valueOrEmpty(row, colLaps))
				gridPos := atoiSafe(valueOrEmpty(row, colGrid))
				lapsLed := atoiSafe(valueOrEmpty(row, colLapsLed))
				fastestLap := strings.TrimSpace(valueOrEmpty(row, colBestLap))
				if err := st.UpsertResult(ctx, &models.Result{
					ID:           resID,
					RaceID:       raceID,
					DriverID:     driverID,
					TeamID:       teamID,
					CarNumber:    carNumber,
					Position:     pos,
					GridPosition: gridPos,
					Laps:         laps,
					LapsLed:      lapsLed,
					Status:       status,
					Points:       points,
					FastestLap:   fastestLap,
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func firstHeaderIndex(headers []string, names ...string) int {
	return tableutil.FirstColIndex(headers, names...)
}

func valueOrEmpty(row []string, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

func atoiSafe(s string) int {
	s = strings.TrimSpace(s)
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}

func maxIntColumn(headers []string, rows [][]string, names []string) int {
	col := firstHeaderIndex(headers, names...)
	if col < 0 {
		return 0
	}
	maxVal := 0
	for _, row := range rows {
		if col >= len(row) {
			continue
		}
		v := atoiSafe(strings.TrimSpace(row[col]))
		if v > maxVal {
			maxVal = v
		}
	}
	return maxVal
}

func makeTeamID(seriesID, teamName string) string {
	if teamName == "" {
		return ""
	}
	return strings.ToUpper(seriesID) + ":TEAM:" + driverutil.NormalizeKey(teamName)
}

