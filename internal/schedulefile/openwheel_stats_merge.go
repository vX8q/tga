package schedulefile

import (
	"strconv"
	"strings"
)

// mergeOpenWheelDriverStatsRows объединяет дубликаты строк статистики для формульных серий (F1/F2/F3).
// Группировка по canonicalDriverKey(driver) даёт одну строку на пилота, независимо от вариаций Team/Chassis.
func mergeOpenWheelDriverStatsRows(rows []DriverStatsRow) []DriverStatsRow {
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
		canon := canonicalDriverKey(strings.TrimSpace(r.Driver))
		if canon == "" {
			canon = strings.TrimSpace(r.Driver)
		}
		k := key{driver: canon}
		if existing, ok := merged[k]; ok {
			prevRaces := existing.Races
			totalRaces := prevRaces + r.Races
			if totalRaces == 0 {
				continue
			}
			existing.Races = totalRaces
			existing.Wins += r.Wins
			existing.Poles += r.Poles
			// Open‑wheel specific podium granularity.
			existing.Top2 += r.Top2
			existing.Top3 += r.Top3
			existing.Podiums += r.Podiums
			existing.Top5 += r.Top5
			existing.Top10 += r.Top10
			existing.Top15 += r.Top15
			existing.Top20 += r.Top20
			// Fastest laps and laps completed.
			existing.FastestLaps += r.FastestLaps
			existing.StageWins += r.StageWins
			existing.StagePoints += r.StagePoints
			existing.LapsLed += r.LapsLed
			existing.LapsCompleted += r.LapsCompleted
			// BestLap: выбираем лучший (минимальный по времени) круг.
			existing.BestLap = betterLap(existing.BestLap, r.BestLap)

			// Взвешенные средние по количеству гонок.
			existing.AvgFinish = (existing.AvgFinish*float64(prevRaces) + r.AvgFinish*float64(r.Races)) / float64(totalRaces)
			existing.AvgStart = (existing.AvgStart*float64(prevRaces) + r.AvgStart*float64(r.Races)) / float64(totalRaces)
			// AvgQualifying/AvgStart в БД считаются как среднее по гонкам,
			// поэтому при склейке строк пересчитываем взвешенно по числу гонок.
			// 0 считаем "нет данных", чтобы не портить среднее.
			var qualSum float64
			var qualCnt float64
			if existing.AvgQualifying > 0 {
				qualSum += existing.AvgQualifying * float64(prevRaces)
				qualCnt += float64(prevRaces)
			}
			if r.AvgQualifying > 0 {
				qualSum += r.AvgQualifying * float64(r.Races)
				qualCnt += float64(r.Races)
			}
			if qualCnt > 0 {
				existing.AvgQualifying = qualSum / qualCnt
			} else {
				existing.AvgQualifying = 0
			}
			existing.LapsCompletedPct = (existing.LapsCompletedPct*float64(prevRaces) + r.LapsCompletedPct*float64(r.Races)) / float64(totalRaces)
			existing.PositionDiff = (existing.PositionDiff*float64(prevRaces) + r.PositionDiff*float64(r.Races)) / float64(totalRaces)
			if totalRaces > 0 {
				existing.AvgStagePoints = float64(existing.StagePoints) / float64(totalRaces)
			}

			// Поля справочников берём из строки с большим количеством гонок, если они заполнены.
			if r.Team != "" && (existing.Team == "" || r.Races > prevRaces) {
				existing.Team = r.Team
			}
			if r.Manufacturer != "" && (existing.Manufacturer == "" || r.Races > prevRaces) {
				existing.Manufacturer = r.Manufacturer
			}
			if strings.TrimSpace(r.Car) != "" && (strings.TrimSpace(existing.Car) == "" || r.Races > prevRaces) {
				existing.Car = strings.TrimSpace(r.Car)
			}
			// Отображаемое имя — вариант с большим числом гонок.
			if r.Races > prevRaces && strings.TrimSpace(r.Driver) != "" {
				existing.Driver = r.Driver
			}
			continue
		}
		r2 := *r
		merged[k] = &r2
		order = append(order, k)
	}
	out := make([]DriverStatsRow, 0, len(order))
	for _, k := range order {
		out = append(out, *merged[k])
	}
	return out
}

// betterLap возвращает лучший (меньший по времени) круг между a и b.
// Форматы: "M:SS.mmm" или "SS.mmm". При ошибке парсинга берём непустое значение.
func betterLap(a, b string) string {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" {
		return b
	}
	if b == "" {
		return a
	}
	ta, okA := parseLapTimeSeconds(a)
	tb, okB := parseLapTimeSeconds(b)
	if okA && okB {
		if ta <= tb {
			return a
		}
		return b
	}
	// Если один из форматов не разобрали — отдаём тот, который разобрался, или a по умолчанию.
	if okA && !okB {
		return a
	}
	if okB && !okA {
		return b
	}
	return a
}

func parseLapTimeSeconds(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	// Формат M:SS.mmm
	if strings.Contains(s, ":") {
		parts := strings.SplitN(s, ":", 2)
		minsStr := strings.TrimSpace(parts[0])
		secStr := strings.TrimSpace(parts[1])
		mins, err1 := strconv.ParseFloat(minsStr, 64)
		secs, err2 := strconv.ParseFloat(secStr, 64)
		if err1 != nil || err2 != nil {
			return 0, false
		}
		return mins*60 + secs, true
	}
	// Формат SS.mmm
	secs, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return secs, true
}

