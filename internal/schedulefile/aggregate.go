// Package schedulefile provides schedule and stats aggregation utilities.
package schedulefile

import (
	"sort"
	"strings"
)

// aggregateByManufacturer агрегирует драйверские строки по производителям.
func aggregateByManufacturer(rows []DriverStatsRow) []ManufacturerStatsRow {
	type manAcc struct {
		man           string
		races         int
		wins          int
		top2          int
		top3          int
		podiums       int
		poles         int
		top5          int
		top10         int
		top15         int
		top20         int
		fastestLaps   int
		q2Passes      int
		q3Passes      int
		stageWins     int
		stagePoints   int
		lapsLed       int
		lapsCompleted int
		sumFinish     float64
		finishWeight  int
		sumStart      float64
		startWeight   int
		sumQual       float64
		qualWeight    int
		sumLapsPct    float64
		lapsWeight    int
		sumPosDiff    float64
		posDiffWeight int
	}

	byMan := make(map[string]*manAcc)
	for _, d := range rows {
		man := strings.TrimSpace(d.Manufacturer)
		if man == "" {
			continue
		}
		a := byMan[man]
		if a == nil {
			a = &manAcc{man: man}
			byMan[man] = a
		}
		a.races += d.Races
		a.wins += d.Wins
		a.top2 += d.Top2
		a.top3 += d.Top3
		a.podiums += d.Podiums
		a.poles += d.Poles
		a.top5 += d.Top5
		a.top10 += d.Top10
		a.top15 += d.Top15
		a.top20 += d.Top20
		a.fastestLaps += d.FastestLaps
		a.q2Passes += d.Q2Passes
		a.q3Passes += d.Q3Passes
		a.stageWins += d.StageWins
		a.stagePoints += d.StagePoints
		a.lapsLed += d.LapsLed
		a.lapsCompleted += d.LapsCompleted
		if d.AvgFinish > 0 && d.Races > 0 {
			a.sumFinish += d.AvgFinish * float64(d.Races)
			a.finishWeight += d.Races
		}
		if d.AvgStart > 0 && d.Races > 0 {
			a.sumStart += d.AvgStart * float64(d.Races)
			a.startWeight += d.Races
		}
		if d.AvgQualifying > 0 && d.Races > 0 {
			a.sumQual += d.AvgQualifying * float64(d.Races)
			a.qualWeight += d.Races
		}
		if d.LapsCompletedPct > 0 && d.Races > 0 {
			a.sumLapsPct += d.LapsCompletedPct * float64(d.Races)
			a.lapsWeight += d.Races
		}
		if d.PositionDiff != 0 && d.Races > 0 {
			a.sumPosDiff += d.PositionDiff * float64(d.Races)
			a.posDiffWeight += d.Races
		}
	}

	var out []ManufacturerStatsRow
	for _, a := range byMan {
		if a.races == 0 {
			continue
		}
		out = append(out, ManufacturerStatsRow{
			Manufacturer:     a.man,
			Races:            a.races,
			Wins:             a.wins,
			Top2:             a.top2,
			Top3:             a.top3,
			Podiums:          a.podiums,
			Poles:            a.poles,
			Top5:             a.top5,
			Top10:            a.top10,
			Top15:            a.top15,
			Top20:            a.top20,
			FastestLaps:      a.fastestLaps,
			AvgFinish:        roundTo(divSafe(a.sumFinish, float64(a.finishWeight)), 2),
			AvgStart:         roundTo(divSafe(a.sumStart, float64(a.startWeight)), 2),
			AvgQualifying:    roundTo(divSafe(a.sumQual, float64(a.qualWeight)), 2),
			Q2Passes:         a.q2Passes,
			Q3Passes:         a.q3Passes,
			StageWins:        a.stageWins,
			StagePoints:      a.stagePoints,
			AvgStagePoints:   roundTo(divSafe(float64(a.stagePoints), float64(a.races)), 2),
			LapsLed:          a.lapsLed,
			LapsCompleted:    a.lapsCompleted,
			LapsCompletedPct: roundTo(divSafe(a.sumLapsPct, float64(a.lapsWeight)), 1),
			PositionDiff:     roundTo(divSafe(a.sumPosDiff, float64(a.posDiffWeight)), 2),
		})
	}

	// сортируем так же, как было раньше
	sort.Slice(out, func(i, j int) bool {
		if out[i].Wins != out[j].Wins {
			return out[i].Wins > out[j].Wins
		}
		if out[i].Podiums != out[j].Podiums {
			return out[i].Podiums > out[j].Podiums
		}
		if out[i].Top5 != out[j].Top5 {
			return out[i].Top5 > out[j].Top5
		}
		if out[i].Top10 != out[j].Top10 {
			return out[i].Top10 > out[j].Top10
		}
		return out[i].Manufacturer < out[j].Manufacturer
	})

	return out
}

// aggregateByTeam агрегирует драйверские строки по командам.
func aggregateByTeam(rows []DriverStatsRow) []TeamStatsRow {
	type teamAcc struct {
		team             string
		races            int
		wins             int
		poles            int
		top5             int
		top10            int
		top15            int
		top20            int
		stageWins        int
		stagePoints      int
		lapsLed          int
		sumFinish        float64
		finishWeight     int
		sumStart         float64
		startWeight      int
		sumLapsPct       float64
		lapsWeight       int
		sumPosDiff       float64
		posDiffWeight    int
	}

	byTeam := make(map[string]*teamAcc)
	for _, d := range rows {
		team := strings.TrimSpace(d.Team)
		if team == "" {
			team = "—"
		}
		a := byTeam[team]
		if a == nil {
			a = &teamAcc{team: team}
			byTeam[team] = a
		}
		a.races += d.Races
		a.wins += d.Wins
		a.poles += d.Poles
		a.top5 += d.Top5
		a.top10 += d.Top10
		a.top15 += d.Top15
		a.top20 += d.Top20
		a.stageWins += d.StageWins
		a.stagePoints += d.StagePoints
		a.lapsLed += d.LapsLed
		if d.AvgFinish > 0 && d.Races > 0 {
			a.sumFinish += d.AvgFinish * float64(d.Races)
			a.finishWeight += d.Races
		}
		if d.AvgStart > 0 && d.Races > 0 {
			a.sumStart += d.AvgStart * float64(d.Races)
			a.startWeight += d.Races
		}
		if d.LapsCompletedPct > 0 && d.Races > 0 {
			a.sumLapsPct += d.LapsCompletedPct * float64(d.Races)
			a.lapsWeight += d.Races
		}
		if d.PositionDiff != 0 && d.Races > 0 {
			a.sumPosDiff += d.PositionDiff * float64(d.Races)
			a.posDiffWeight += d.Races
		}
	}

	var out []TeamStatsRow
	for _, a := range byTeam {
		if a.races == 0 {
			continue
		}
		out = append(out, TeamStatsRow{
			Team:             a.team,
			Races:            a.races,
			Wins:             a.wins,
			Poles:            a.poles,
			Top5:             a.top5,
			Top10:            a.top10,
			Top15:            a.top15,
			Top20:            a.top20,
			AvgFinish:        roundTo(divSafe(a.sumFinish, float64(a.finishWeight)), 2),
			AvgStart:         roundTo(divSafe(a.sumStart, float64(a.startWeight)), 2),
			StageWins:        a.stageWins,
			StagePoints:      a.stagePoints,
			AvgStagePoints:   roundTo(divSafe(float64(a.stagePoints), float64(a.races)), 2),
			LapsLed:          a.lapsLed,
			LapsCompletedPct: roundTo(divSafe(a.sumLapsPct, float64(a.lapsWeight)), 1),
			PositionDiff:     roundTo(divSafe(a.sumPosDiff, float64(a.posDiffWeight)), 2),
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
		return out[i].Team < out[j].Team
	})

	return out
}

