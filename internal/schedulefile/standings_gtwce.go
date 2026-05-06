package schedulefile

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/vX8q/tga/config"
)

type gtwceEntryBrief struct {
	number, team, drivers, car string
}

func loadGtwceEntryBriefs(dataDir, eventID string) []gtwceEntryBrief {
	raw, err := ReadEventDetailFile(dataDir, eventID)
	if err != nil || len(raw) == 0 {
		return nil
	}
	var root struct {
		EntryList []map[string]any `json:"entry_list"`
	}
	if err := json.Unmarshal(raw, &root); err != nil || len(root.EntryList) == 0 {
		return nil
	}
	var out []gtwceEntryBrief
	for _, m := range root.EntryList {
		num := strings.TrimSpace(fmt.Sprint(m["number"]))
		if num == "" {
			continue
		}
		var parts []string
		for _, k := range []string{"driver1", "driver2", "driver3"} {
			s := strings.TrimSpace(fmt.Sprint(m[k]))
			if s != "" {
				parts = append(parts, s)
			}
		}
		out = append(out, gtwceEntryBrief{
			number:  num,
			team:    strings.TrimSpace(fmt.Sprint(m["team"])),
			car:     strings.TrimSpace(fmt.Sprint(m["car"])),
			drivers: strings.Join(parts, ", "),
		})
	}
	return out
}

// gtwceMergeEntryListIntoOverall добавляет в Overall экипажи из entry_list этапов сезона,
// которых нет в протоколе гонки (0 очков, пустые ячейки этапов → на фронте «—» для завершённых гонок).
func gtwceMergeEntryListIntoOverall(dataDir string, events []EventJSON, season string, overall map[string]*gtwceAcc) {
	for _, ev := range events {
		if ev.Season != season {
			continue
		}
		for _, e := range loadGtwceEntryBriefs(dataDir, ev.ID) {
			if overall[e.number] != nil {
				continue
			}
			overall[e.number] = &gtwceAcc{
				racePos:  make(map[string]string),
				team:     e.team,
				drivers:  e.drivers,
				carModel: e.car,
			}
		}
	}
}

// gtwceRaceSlots возвращает число колонок standings на один этап (2 гонки Sprint или 1 Endurance).
func gtwceRaceSlotsPerEvent(isSprint bool, sessions []RaceSession) int {
	n := len(sessions)
	if n > 0 {
		return n
	}
	if isSprint {
		return 2
	}
	return 1
}

type gtwceAcc struct {
	team, drivers, carModel string
	racePos                 map[string]string // код этапа → позиция в гонке (для отображения)
	points                  float64
}

type gtwceSessRow struct {
	carNum                 string
	cls, bName             string
	posRaw                 string
	posNum                 int
	posIsNC                bool
	cupPts, overallPts     float64
	team, drivers, chassis string
}

func gtwceParseRacePos(s string) (num int, isNC bool) {
	p := strings.TrimSpace(s)
	if p == "" {
		return 0, true
	}
	up := strings.ToUpper(p)
	if up == "NC" || strings.HasPrefix(up, "NC") || up == "RET" || up == "DNF" || up == "DNS" || up == "DSQ" {
		return 0, true
	}
	if strings.HasPrefix(up, "P") {
		rest := strings.TrimPrefix(up, "P")
		n, err := strconv.Atoi(strings.TrimSpace(rest))
		if err == nil {
			return n, false
		}
	}
	n, err := strconv.Atoi(up)
	if err != nil {
		return 0, true
	}
	return n, false
}

func gtwceDisplayAbsPos(raw string, isNC bool) string {
	s := strings.TrimSpace(raw)
	if isNC {
		if s != "" {
			return s
		}
		return "NC"
	}
	return s
}

// gtwceClassRankInSession: места 1, 2, 3… внутри класса по абсолютному порядку финиша.
func gtwceClassRankInSession(rows []gtwceSessRow, bucket string) map[string]string {
	out := make(map[string]string)
	var sub []gtwceSessRow
	for i := range rows {
		if rows[i].bName == bucket {
			sub = append(sub, rows[i])
		}
	}
	if len(sub) == 0 {
		return out
	}
	sort.Slice(sub, func(i, j int) bool {
		ncI, ncJ := sub[i].posIsNC, sub[j].posIsNC
		if ncI != ncJ {
			return !ncI
		}
		if ncI {
			return false
		}
		return sub[i].posNum < sub[j].posNum
	})
	rank := 1
	for _, r := range sub {
		if r.posIsNC {
			d := strings.TrimSpace(r.posRaw)
			if d == "" {
				d = "NC"
			}
			out[r.carNum] = d
			continue
		}
		out[r.carNum] = strconv.Itoa(rank)
		rank++
	}
	return out
}

func gtwceSessionPositionsByCar(sessRows []gtwceSessRow) map[string]map[string]string {
	out := map[string]map[string]string{
		"overall": make(map[string]string),
		"gold":    gtwceClassRankInSession(sessRows, "gold"),
		"silver":  gtwceClassRankInSession(sessRows, "silver"),
		"bronze":  gtwceClassRankInSession(sessRows, "bronze"),
	}
	for i := range sessRows {
		r := &sessRows[i]
		// Абсолютная позиция финиша для championship Overall — для всех классов.
		out["overall"][r.carNum] = gtwceDisplayAbsPos(r.posRaw, r.posIsNC)
	}
	return out
}

func formatGtwcePtsTotal(v float64) string {
	if math.Abs(v-math.Round(v)) < 1e-9 {
		return strconv.Itoa(int(math.Round(v)))
	}
	return strconv.FormatFloat(v, 'f', 1, 64)
}

func parseGtwcePointsCell(s string) float64 {
	s = strings.TrimSpace(s)
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

func gtwceBucketForClass(class string) string {
	c := strings.TrimSpace(class)
	switch {
	case strings.EqualFold(c, "Pro Cup"):
		return "overall"
	case strings.EqualFold(c, "Gold Cup"):
		return "gold"
	case strings.EqualFold(c, "Silver Cup"):
		return "silver"
	case strings.EqualFold(c, "Bronze Cup"):
		return "bronze"
	default:
		return ""
	}
}

// BuildGtwceStandingsFromEvents строит 4 таблицы: Overall (все экипажи, сумма Overall pts по абсолютному зачёту),
// Gold / Silver / Bronze (сумма Cup pts).
// В колонках этапов: Overall = абсолютный Pos; классы = место в классе (1, 2, …).
func BuildGtwceStandingsFromEvents(dataDir string, seriesID string, season string) (*StandingsData, error) {
	sidUp := strings.ToUpper(strings.TrimSpace(seriesID))
	isSprint := strings.EqualFold(sidUp, "GTWCE_SPRINT")
	if !isSprint && !strings.EqualFold(sidUp, "GTWCE_END") {
		return nil, fmt.Errorf("BuildGtwceStandingsFromEvents: not a GTWCE series: %q", seriesID)
	}
	if strings.TrimSpace(season) == "" {
		season = config.CurrentSeason
	}
	events, err := LoadEvents(dataDir, strings.ToLower(sidUp))
	if err != nil || len(events) == 0 {
		return emptyGtwceStandings(), nil
	}

	var raceOrder []string
	var eventNames []string
	round := 0
	for _, ev := range events {
		if ev.Season != season {
			continue
		}
		round++
		sessions, _ := LoadEventRaceSessions(dataDir, ev.ID)
		n := gtwceRaceSlotsPerEvent(isSprint, sessions)
		evName := strings.TrimSpace(ev.Name)
		for si := 0; si < n; si++ {
			var code string
			if isSprint {
				code = fmt.Sprintf("R%d-%d", round, si+1)
			} else if n > 1 {
				code = fmt.Sprintf("R%d-%d", round, si+1)
			} else {
				code = "R" + strconv.Itoa(round)
			}
			raceOrder = append(raceOrder, code)
			eventNames = append(eventNames, evName)
		}
	}

	buckets := map[string]map[string]*gtwceAcc{
		"overall": {},
		"gold":    {},
		"silver":  {},
		"bronze":  {},
	}
	completedSet := map[string]bool{}

	rIdx := 0
	round = 0
	for _, ev := range events {
		if ev.Season != season {
			continue
		}
		round++
		sessions, _ := LoadEventRaceSessions(dataDir, ev.ID)
		n := gtwceRaceSlotsPerEvent(isSprint, sessions)
		for si := 0; si < n; si++ {
			if rIdx >= len(raceOrder) {
				break
			}
			code := raceOrder[rIdx]
			rIdx++
			var sess *RaceSession
			if si < len(sessions) {
				sess = &sessions[si]
			}
			if sess == nil || len(sess.Headers) == 0 || len(sess.Rows) == 0 {
				continue
			}
			completedSet[code] = true

			h := sess.Headers
			classCol := colIndex(h, "Class")
			carCol := colIndex(h, "Car #")
			if carCol < 0 {
				carCol = firstColIndex(h, "No.", "No", "#")
			}
			teamCol := colIndex(h, "Team")
			drvCol := colIndex(h, "Drivers")
			if drvCol < 0 {
				drvCol = colIndex(h, "Driver")
			}
			chassisCol := colIndex(h, "Car")
			cupCol := colIndex(h, "Cup pts")
			ovCol := colIndex(h, "Overall pts")
			posCol := colIndex(h, "Pos")
			if posCol < 0 {
				posCol = colIndex(h, "Pos.")
			}
			if classCol < 0 || carCol < 0 || posCol < 0 {
				continue
			}

			var sessRows []gtwceSessRow
			for _, row := range sess.Rows {
				if classCol >= len(row) || carCol >= len(row) {
					continue
				}
				cls := strings.TrimSpace(row[classCol])
				bName := gtwceBucketForClass(cls)
				if bName == "" {
					continue
				}
				carNum := strings.TrimSpace(row[carCol])
				if carNum == "" {
					continue
				}
				rawPos := ""
				if posCol < len(row) {
					rawPos = strings.TrimSpace(row[posCol])
				}
				pn, pnc := gtwceParseRacePos(rawPos)
				var cupPts, ovPts float64
				if cupCol >= 0 && cupCol < len(row) {
					cupPts = parseGtwcePointsCell(row[cupCol])
				}
				if ovCol >= 0 && ovCol < len(row) {
					ovPts = parseGtwcePointsCell(row[ovCol])
				}
				team := ""
				if teamCol >= 0 && teamCol < len(row) {
					team = strings.TrimSpace(row[teamCol])
				}
				drivers := ""
				if drvCol >= 0 && drvCol < len(row) {
					drivers = strings.TrimSpace(row[drvCol])
				}
				chassis := ""
				if chassisCol >= 0 && chassisCol < len(row) {
					chassis = strings.TrimSpace(row[chassisCol])
				}
				sessRows = append(sessRows, gtwceSessRow{
					carNum: carNum, cls: cls, bName: bName,
					posRaw: rawPos, posNum: pn, posIsNC: pnc,
					cupPts: cupPts, overallPts: ovPts,
					team: team, drivers: drivers, chassis: chassis,
				})
			}
			posByBucketCar := gtwceSessionPositionsByCar(sessRows)
			// Overall: все классы, очки из колонки Overall pts, в ячейках — абсолютная позиция.
			for _, sr := range sessRows {
				cell := posByBucketCar["overall"][sr.carNum]
				if cell == "" {
					continue
				}
				bo := buckets["overall"]
				if bo[sr.carNum] == nil {
					bo[sr.carNum] = &gtwceAcc{racePos: make(map[string]string)}
				}
				ao := bo[sr.carNum]
				if sr.team != "" {
					ao.team = sr.team
				}
				if sr.drivers != "" {
					ao.drivers = sr.drivers
				}
				if sr.chassis != "" {
					ao.carModel = sr.chassis
				}
				ao.racePos[code] = cell
				ao.points += sr.overallPts
			}
			// Gold / Silver / Bronze: только экипажи своего класса, Cup pts, место в классе.
			for _, sr := range sessRows {
				if sr.bName != "gold" && sr.bName != "silver" && sr.bName != "bronze" {
					continue
				}
				cell := posByBucketCar[sr.bName][sr.carNum]
				if cell == "" {
					continue
				}
				b := buckets[sr.bName]
				if b[sr.carNum] == nil {
					b[sr.carNum] = &gtwceAcc{racePos: make(map[string]string)}
				}
				a := b[sr.carNum]
				if sr.team != "" {
					a.team = sr.team
				}
				if sr.drivers != "" {
					a.drivers = sr.drivers
				}
				if sr.chassis != "" {
					a.carModel = sr.chassis
				}
				a.racePos[code] = cell
				a.points += sr.cupPts
			}
		}
	}

	gtwceMergeEntryListIntoOverall(dataDir, events, season, buckets["overall"])

	// Порядок completed как в race_order
	completedOrdered := make([]string, 0, len(raceOrder))
	for _, c := range raceOrder {
		if completedSet[c] {
			completedOrdered = append(completedOrdered, c)
		}
	}

	classMeta := []struct {
		id, tableName string
	}{
		{"overall", "Overall"},
		{"gold", "Gold Cup"},
		{"silver", "Silver Cup"},
		{"bronze", "Bronze Cup"},
	}
	var classes []StandingsClass
	for _, cm := range classMeta {
		rows := gtwceStandingRowsFromBucket(buckets[cm.id], raceOrder)
		classes = append(classes, StandingsClass{
			ID:   cm.id,
			Name: cm.tableName,
			Rows: rows,
		})
	}

	return &StandingsData{
		RaceOrder:      raceOrder,
		EventNames:     eventNames,
		CompletedRaces: completedOrdered,
		Rows:           []StandingRow{},
		Classes:        classes,
	}, nil
}

func emptyGtwceStandings() *StandingsData {
	return &StandingsData{
		RaceOrder:      []string{},
		EventNames:     []string{},
		CompletedRaces: []string{},
		Rows:           []StandingRow{},
		Classes: []StandingsClass{
			{ID: "overall", Name: "Overall", Rows: []StandingRow{}},
			{ID: "gold", Name: "Gold Cup", Rows: []StandingRow{}},
			{ID: "silver", Name: "Silver Cup", Rows: []StandingRow{}},
			{ID: "bronze", Name: "Bronze Cup", Rows: []StandingRow{}},
		},
	}
}

func gtwceStandingRowsFromBucket(byCar map[string]*gtwceAcc, raceOrder []string) []StandingRow {
	if len(byCar) == 0 {
		return nil
	}
	type kv struct {
		car string
		a   *gtwceAcc
	}
	var list []kv
	for car, a := range byCar {
		if a == nil {
			continue
		}
		list = append(list, kv{car: car, a: a})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].a.points != list[j].a.points {
			return list[i].a.points > list[j].a.points
		}
		return naturalCarLess(list[i].car, list[j].car)
	})
	out := make([]StandingRow, 0, len(list))
	for i, e := range list {
		a := e.a
		raceStr := make(map[string]string)
		for _, code := range raceOrder {
			if v, ok := a.racePos[code]; ok && v != "" {
				raceStr[code] = v
			}
		}
		out = append(out, StandingRow{
			Pos:          i + 1,
			Car:          e.car,
			Driver:       a.drivers,
			Team:         a.team,
			Manufacturer: a.carModel,
			Points:       formatGtwcePtsTotal(a.points),
			Races:        raceStr,
		})
	}
	return out
}

func naturalCarLess(a, b string) bool {
	ai, errA := strconv.Atoi(strings.TrimSpace(a))
	bi, errB := strconv.Atoi(strings.TrimSpace(b))
	if errA == nil && errB == nil {
		return ai < bi
	}
	return strings.TrimSpace(a) < strings.TrimSpace(b)
}
