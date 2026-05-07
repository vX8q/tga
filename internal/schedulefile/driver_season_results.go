package schedulefile

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/models"
)

// BuildDriverSeasonResultsFromEvents строит season_results для страницы пилота
// исключительно из data/events/*.json (без SQLite).
func BuildDriverSeasonResultsFromEvents(dataDir string, driverSlug string, season string) ([]models.DriverSeasonResult, error) {
	driverSlug = strings.ToLower(strings.TrimSpace(driverSlug))
	if driverSlug == "" {
		return nil, nil
	}

	// Для сортировки по дате старта события.
	eventStartByID := make(map[string]time.Time)

	var out []models.DriverSeasonResult
	for _, champ := range config.Championships {
		events, err := LoadEvents(dataDir, champ.ID)
		if err != nil || len(events) == 0 {
			continue
		}

		seriesName := champ.Name
		seriesID := champ.ID

		for _, ev := range events {
			if season != "" && ev.Season != season {
				continue
			}

			start := parseDateSafe(ev.StartDate)
			if !start.IsZero() && ev.ID != "" {
				eventStartByID[ev.ID] = start
			}

			detail, err := LoadEventDetail(dataDir, ev.ID)
			if err != nil || detail == nil || detail.Tables == nil {
				continue
			}

			eventName := cleanEventName(seriesID, detail.Race)
			if strings.TrimSpace(eventName) == "" {
				eventName = strings.TrimSpace(ev.Name)
			}

			var mainResults []models.DriverSeasonResult
			var sprintResults []models.DriverSeasonResult

			// Основная гонка (race_results или fallback tables.race).
			mainHeaders, mainRows, okMain := tableHeadersRows(detail.Tables, "race_results")
			if okMain {
				mainRaceName := eventName
				// На странице F1 race_name должен быть непустым, иначе фронт может
				// пропустить колонку Race (и/или сломать структуру <table>).
				// Содержимое "eventName" потом преобразуется на фронте в "Feature".
				mainResults = append(mainResults, parseDriverFromRaceTable(
					seriesID, seriesName,
					ev.ID, eventName,
					mainRaceName,
					mainHeaders, mainRows, driverSlug)...)
			} else {
				// Иногда "полная" таблица результатов лежит в tables.race.
				if h, rws, ok := tableHeadersRows(detail.Tables, "race"); ok {
					mainRaceName := eventName
					mainResults = append(mainResults, parseDriverFromRaceTable(
						seriesID, seriesName,
						ev.ID, eventName,
						mainRaceName,
						h, rws, driverSlug)...)
				}
			}

			// Sprint-сессии (для F1/F2/F3 — есть tables.race.sessions).
			sessions, err := LoadEventRaceSessions(dataDir, ev.ID)
			if err == nil && len(sessions) > 0 {
				for _, sess := range sessions {
					titleLower := strings.ToLower(strings.TrimSpace(sess.Title))
					if titleLower == "" {
						continue
					}

					// Для F1 страницы пилота мы хотим отдельной строкой именно Sprint.
					// Для остальных серий добавим все сессии, если main-таблица не найдена.
					if strings.EqualFold(seriesID, "F1") {
						if !strings.Contains(titleLower, "sprint") {
							continue
						}
					} else if okMain {
						// Если main уже есть (race_results), не дублируем остальные сессии.
						continue
					}

					sprintResults = append(sprintResults, parseDriverFromRaceTable(
						seriesID, seriesName,
						ev.ID, eventName,
						sess.Title,
						sess.Headers, sess.Rows, driverSlug)...)
				}
			}

			if strings.EqualFold(seriesID, "IMSA") {
				applyIMSAPointsFallback(detail, mainResults)
				applyIMSAPointsFallback(detail, sprintResults)
			}

			// Порядок строк на странице пилота:
			// - Для F1 при наличии спринта Sprint должен идти первым, Feature — вторым.
			if strings.EqualFold(seriesID, "F1") {
				if len(sprintResults) > 0 {
					out = append(out, sprintResults...)
					out = append(out, mainResults...)
				} else {
					out = append(out, mainResults...)
				}
			} else {
				out = append(out, mainResults...)
				out = append(out, sprintResults...)
			}

			// Если в событии нет найденных race/sprint результатов для пилота,
			// но он присутствует в entry_list (часто endurance/entry-only кейсы),
			// добавляем участие, чтобы на странице пилота отражались все серии за сезон.
			if len(mainResults) == 0 && len(sprintResults) == 0 {
				if er := parseDriverFromEntryList(seriesID, seriesName, ev.ID, eventName, detail.EntryList, driverSlug); len(er) > 0 {
					out = append(out, er...)
				} else if er := parseDriverFromRawEntryList(dataDir, seriesID, seriesName, ev.ID, eventName, driverSlug); len(er) > 0 {
					out = append(out, er...)
				}
			}
		}
	}

	// Deduplicate identical rows that can appear in mixed-source events.
	if len(out) > 1 {
		uniq := make([]models.DriverSeasonResult, 0, len(out))
		seen := make(map[string]struct{}, len(out))
		for _, r := range out {
			key := strings.Join([]string{
				strings.ToUpper(strings.TrimSpace(r.SeriesID)),
				strings.ToUpper(strings.TrimSpace(r.EventID)),
				strings.TrimSpace(r.CarNumber),
				strconv.Itoa(r.Position),
				strconv.Itoa(r.Laps),
				strings.TrimSpace(r.Status),
			}, "|")
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			uniq = append(uniq, r)
		}
		out = uniq
	}

	// Сортировка: сначала по времени старта события, затем по названию гонки (стабильность).
	enrichDriverSeasonPointsFromStandings(dataDir, driverSlug, out)
	sortDriverSeasonResults(out, eventStartByID)
	return out, nil
}

func parseDriverFromRawEntryList(
	dataDir, seriesID, seriesName, eventID, eventName, driverSlug string,
) []models.DriverSeasonResult {
	raw, err := ReadEventDetailFile(dataDir, eventID)
	if err != nil || len(raw) == 0 {
		return nil
	}
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil
	}
	entryAny, ok := root["entry_list"]
	if !ok || entryAny == nil {
		return nil
	}
	rows, ok := entryAny.([]any)
	if !ok {
		return nil
	}
	for _, rowAny := range rows {
		row, ok := rowAny.(map[string]any)
		if !ok {
			continue
		}
		team := strings.TrimSpace(asString(row["team"]))
		number := strings.TrimSpace(asString(row["number"]))
		if number == "" {
			number = strings.TrimSpace(asString(row["car_number"]))
		}
		if number == "" {
			number = strings.TrimSpace(asString(row["no"]))
		}

		var names []string
		for _, key := range []string{"driver", "driver1", "driver2", "driver3", "driver4"} {
			if v, ok := row[key]; ok {
				s := strings.TrimSpace(asString(v))
				if s != "" {
					names = append(names, splitDriverCellNames(s)...)
				}
			}
		}
		if arr, ok := row["drivers"].([]any); ok {
			for _, v := range arr {
				s := strings.TrimSpace(asString(v))
				if s != "" {
					names = append(names, splitDriverCellNames(s)...)
				}
			}
		}
		for _, name := range names {
			if driverutil.Slug(name) != driverSlug {
				continue
			}
			return []models.DriverSeasonResult{
				{
					SeriesID:   seriesID,
					SeriesName: seriesName,
					TeamName:   team,
					EventID:    eventID,
					EventName:  eventName,
					RaceName:   "Entry list",
					Position:   0,
					Points:     0,
					Laps:       0,
					Status:     "Entry list",
					CarNumber:  number,
				},
			}
		}
	}
	return nil
}

func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func splitDriverCellNames(v string) []string {
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		n := strings.TrimSpace(p)
		if n != "" {
			out = append(out, n)
		}
	}
	return out
}

func parseDateSafe(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(dateFormat, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

var f1YearPrefixRe = regexp.MustCompile(`^\d{4}\s+`)
var genericRoundLabelRe = regexp.MustCompile(`^\d+\s+of\s+\d+$`)

func cleanEventName(seriesID, raceField string) string {
	raceField = strings.TrimSpace(raceField)
	if raceField == "" {
		return ""
	}
	// Generic placeholders like "1 of 36" are not event names.
	// In this case we fall back to schedule event name.
	if genericRoundLabelRe.MatchString(strings.ToLower(raceField)) {
		return ""
	}

	// Для F1 в json бывает "F1 — Australian Grand Prix" или "2026 Chinese Grand Prix".
	if strings.EqualFold(seriesID, "F1") {
		raceField = strings.TrimSpace(
			strings.TrimPrefix(strings.TrimSpace(raceField), "F1 — "),
		)
		raceField = strings.TrimSpace(
			strings.TrimPrefix(strings.TrimSpace(raceField), "F1 - "),
		)
		raceField = f1YearPrefixRe.ReplaceAllString(raceField, "")
	}
	return strings.TrimSpace(raceField)
}

func tableHeadersRows(tables map[string]EventTable, key string) (headers []string, rows [][]string, ok bool) {
	if tables == nil {
		return nil, nil, false
	}
	tbl, ok := tables[key]
	if !ok || len(tbl.Headers) == 0 || len(tbl.Rows) == 0 {
		return nil, nil, false
	}
	return tbl.Headers, tbl.Rows, true
}

func parseDriverFromRaceTable(
	seriesID, seriesName, eventID, eventName, raceName string,
	headers []string, rows [][]string,
	driverSlug string,
) []models.DriverSeasonResult {
	if len(headers) == 0 || len(rows) == 0 {
		return nil
	}

	colPos := firstColIndex(headers, "Pos", "Fin")
	if colPos < 0 {
		// Иногда в таблицах встречаются "Fin" без "Pos".
		colPos = firstColIndex(headers, "Fin.")
	}

	colDriver := firstColIndex(headers, "Driver", "Drivers", "Driver Name")
	colNo := firstColIndex(headers, "No", "No.", "#", "Car", "Car No", "CAR NO")
	colTeam := firstColIndex(headers, "Team", "Entrant", "Constructor")

	colLaps := firstColIndex(headers, "Laps", "No Laps", "NO LAPS", "Laps Completed")

	colPoints := firstColIndex(headers,
		"Points", "Points.",
		"Pts", "Pts.", "Pts..",
		"Total Points", "TOTAL POINTS",
		"Class Points", "CLASS POINTS",
	)
	if colPoints < 0 {
		// Last try
		colPoints = colIndex(headers, "Pts")
	}

	// В F1 есть Time/Retired, используем как status для non-finish.
	colTimeRetired := firstColIndex(headers,
		"Time/Retired",
		"Time / Retired",
	)

	colStatus := firstColIndex(headers, "Status", "Reason", "Notes")
	if colStatus < 0 {
		colStatus = colTimeRetired
	}
	statusFromTime := colTimeRetired >= 0 && colStatus == colTimeRetired

	if colDriver < 0 || colPos < 0 || colNo < 0 || colLaps < 0 {
		// Для корректных результатов нам нужны как минимум позиция/пилот/номер/круги.
		return nil
	}

	var out []models.DriverSeasonResult
	for _, row := range rows {
		driver := valueAt(row, colDriver)
		if driver == "" {
			continue
		}

		if !driverCellMatchesSlug(driver, driverSlug) {
			continue
		}

		posStr := valueAt(row, colPos)
		pos := atoiSafe(posStr)

		laps := atoiSafe(valueAt(row, colLaps))

		pts := float64(0)
		if colPoints >= 0 {
			if ps := strings.TrimSpace(valueAt(row, colPoints)); ps != "" && ps != "—" {
				pts = parseFloatLoose(ps)
			}
		}

		status := ""
		if colStatus >= 0 && !(statusFromTime && pos > 0) {
			status = valueAt(row, colStatus)
		}
		// IMSA в некоторых таблицах даёт финишный гэп вместо текстового статуса.
		// Для UI такие строки считаем валидным финишем (Running).
		if strings.EqualFold(seriesID, "IMSA") && strings.HasPrefix(strings.TrimSpace(status), "+") {
			status = "Running"
		}
		if pos == 0 && status == "" && posStr != "" {
			// Для DNS/Ret/NC.
			status = posStr
		}
		// Для NASCAR-подобных таблиц во многих JSON статус не передаётся отдельной колонкой.
		// Чтобы в UI статус был заполнен в каждой строке, используем "Finished" для
		// валидных финишных позиций, когда явный статус отсутствует.
		if status == "" && pos > 0 {
			if strings.EqualFold(seriesID, "NASCAR_CUP") ||
				strings.EqualFold(seriesID, "NOAPS") ||
				strings.EqualFold(seriesID, "NASCAR_TRUCK") ||
				strings.EqualFold(seriesID, "ARCA") ||
				strings.EqualFold(seriesID, "NASCAR_MODIFIED") {
				status = "Finished"
			}
		}
		// В NASCAR источники иногда отдают "Running" в финальном race_results.
		// Для карточки пилота это должен быть финишный статус.
		if strings.EqualFold(status, "Running") &&
			(strings.EqualFold(seriesID, "NASCAR_CUP") ||
				strings.EqualFold(seriesID, "NOAPS") ||
				strings.EqualFold(seriesID, "NASCAR_TRUCK") ||
				strings.EqualFold(seriesID, "ARCA") ||
				strings.EqualFold(seriesID, "NASCAR_MODIFIED")) {
			status = "Finished"
		}

		carNumber := valueAt(row, colNo)
		teamName := valueAt(row, colTeam)
		out = append(out, models.DriverSeasonResult{
			SeriesID:   seriesID,
			SeriesName: seriesName,
			TeamName:   teamName,
			EventID:    eventID,
			EventName:  eventName,
			RaceName:   raceName,
			Position:   pos,
			Points:     pts,
			Laps:       laps,
			Status:     status,
			CarNumber:  carNumber,
		})
	}

	return out
}

func parseDriverFromEntryList(
	seriesID, seriesName, eventID, eventName string,
	entry []EntryListRow,
	driverSlug string,
) []models.DriverSeasonResult {
	if len(entry) == 0 {
		return nil
	}
	for _, r := range entry {
		if !driverCellMatchesSlug(r.Driver, driverSlug) {
			continue
		}
		return []models.DriverSeasonResult{
			{
				SeriesID:   seriesID,
				SeriesName: seriesName,
				TeamName:   strings.TrimSpace(r.Team),
				EventID:    eventID,
				EventName:  eventName,
				RaceName:   "Entry list",
				Position:   0,
				Points:     0,
				Laps:       0,
				Status:     "Entry list",
				CarNumber:  strings.TrimSpace(r.Number),
			},
		}
	}
	return nil
}

func enrichDriverSeasonPointsFromStandings(dataDir, driverSlug string, rows []models.DriverSeasonResult) {
	if len(rows) == 0 {
		return
	}
	seriesSet := map[string]struct{}{}
	for _, r := range rows {
		if strings.TrimSpace(r.SeriesID) != "" {
			seriesSet[strings.ToUpper(strings.TrimSpace(r.SeriesID))] = struct{}{}
		}
	}
	pointsBySeries := map[string]float64{}
	for sid := range seriesSet {
		st, err := LoadStandings(dataDir, sid)
		if err != nil || st == nil {
			continue
		}
		p := findDriverStandingsPoints(st, driverSlug)
		if p > 0 {
			pointsBySeries[sid] = p
		}
	}
	for i := range rows {
		if rows[i].Points > 0 {
			continue
		}
		sid := strings.ToUpper(strings.TrimSpace(rows[i].SeriesID))
		if p, ok := pointsBySeries[sid]; ok && p > 0 {
			rows[i].Points = p
		}
	}
}

func findDriverStandingsPoints(st *StandingsData, driverSlug string) float64 {
	if st == nil {
		return 0
	}
	best := float64(0)
	checkRow := func(r StandingRow) {
		if !driverCellMatchesSlug(r.Driver, driverSlug) {
			return
		}
		p := parseFloatLoose(strings.TrimSpace(r.Points))
		if p > best {
			best = p
		}
	}
	for _, r := range st.Rows {
		checkRow(r)
	}
	for _, c := range st.Classes {
		for _, r := range c.Rows {
			checkRow(r)
		}
	}
	return best
}

func applyIMSAPointsFallback(detail *EventDetailJSON, rows []models.DriverSeasonResult) {
	if detail == nil || detail.Tables == nil || len(rows) == 0 {
		return
	}
	qualByCar := map[string]int{}
	if q, ok := detail.Tables["qualifying"]; ok && len(q.Headers) > 0 && len(q.Rows) > 0 {
		carCol := firstColIndex(q.Headers, "CAR NO", "Car No", "No.", "No", "#", "Car")
		classPosCol := firstColIndex(q.Headers, "CLASS POS", "Class Pos")
		posCol := firstColIndex(q.Headers, "POS", "Pos")
		for _, row := range q.Rows {
			car := valueAt(row, carCol)
			if car == "" {
				continue
			}
			qpos := atoiSafe(valueAt(row, classPosCol))
			if qpos <= 0 {
				qpos = atoiSafe(valueAt(row, posCol))
			}
			if qpos > 0 {
				qualByCar[car] = qpos
			}
		}
	}
	for i := range rows {
		if rows[i].Points > 0 {
			continue
		}
		base := imsaRacePointsByPos(rows[i].Position)
		if base <= 0 {
			continue
		}
		qBonus := 0.0
		if qpos, ok := qualByCar[strings.TrimSpace(rows[i].CarNumber)]; ok {
			qBonus = imsaQualifyingPointsByPos(qpos)
		}
		rows[i].Points = base + qBonus
	}
}

func imsaRacePointsByPos(pos int) float64 {
	switch pos {
	case 1:
		return 350
	case 2:
		return 320
	case 3:
		return 300
	case 4:
		return 280
	case 5:
		return 260
	case 6:
		return 240
	case 7:
		return 220
	case 8:
		return 200
	case 9:
		return 180
	case 10:
		return 170
	case 11:
		return 160
	case 12:
		return 150
	case 13:
		return 140
	case 14:
		return 130
	case 15:
		return 120
	case 16:
		return 110
	case 17:
		return 100
	case 18:
		return 90
	case 19:
		return 80
	case 20:
		return 70
	default:
		if pos > 20 {
			return 60
		}
		return 0
	}
}

func imsaQualifyingPointsByPos(pos int) float64 {
	switch pos {
	case 1:
		return 35
	case 2:
		return 32
	case 3:
		return 30
	case 4:
		return 28
	case 5:
		return 26
	case 6:
		return 24
	case 7:
		return 22
	case 8:
		return 20
	case 9:
		return 18
	case 10:
		return 17
	case 11:
		return 16
	case 12:
		return 15
	case 13:
		return 14
	case 14:
		return 13
	case 15:
		return 12
	case 16:
		return 11
	case 17:
		return 10
	case 18:
		return 9
	case 19:
		return 8
	case 20:
		return 7
	default:
		if pos > 20 {
			return 6
		}
		return 0
	}
}

func driverCellMatchesSlug(driverCell, targetSlug string) bool {
	target := strings.TrimSpace(strings.ToLower(targetSlug))
	if target == "" {
		return false
	}
	targetAliases := map[string]struct{}{target: {}}
	parts := strings.Split(target, "-")
	if len(parts) >= 2 {
		first := strings.TrimSpace(parts[0])
		last := strings.TrimSpace(parts[len(parts)-1])
		if first != "" && last != "" {
			targetAliases[strings.ToLower(first[:1]+"-"+last)] = struct{}{}
		}
	}
	candidates := extractDriverNameCandidates(driverCell)
	for _, c := range candidates {
		cSlug := strings.ToLower(strings.TrimSpace(driverutil.Slug(c)))
		if _, ok := targetAliases[cSlug]; ok {
			return true
		}
	}
	return false
}

func extractDriverNameCandidates(driverCell string) []string {
	s := strings.TrimSpace(driverCell)
	if s == "" {
		return nil
	}
	var out []string
	seen := map[string]struct{}{}
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v == "" {
			return
		}
		k := strings.ToLower(v)
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		out = append(out, v)
	}

	// Base raw value.
	add(s)
	// Split common multi-driver separators found in endurance tables.
	parts := strings.FieldsFunc(s, func(r rune) bool {
		return r == '/' || r == '&' || r == ';'
	})
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		add(p)
		// Convert "Lastname, Firstname" -> "Firstname Lastname".
		if strings.Contains(p, ",") {
			seg := strings.Split(p, ",")
			if len(seg) >= 2 {
				last := strings.TrimSpace(seg[0])
				first := strings.TrimSpace(strings.Join(seg[1:], " "))
				if first != "" && last != "" {
					add(first + " " + last)
				}
			}
		}
	}
	return out
}

func parseFloatLoose(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "—" {
		return 0
	}
	s = strings.ReplaceAll(s, ",", ".")

	// Оставляем только символы, похожие на float.
	var b strings.Builder
	for _, r := range s {
		if (r >= '0' && r <= '9') || r == '.' || r == '-' {
			b.WriteRune(r)
		} else if r == '+' {
			continue
		} else {
			// останавливаемся на первом не-числовом
			break
		}
	}
	f, err := strconv.ParseFloat(b.String(), 64)
	if err != nil {
		// log/slog не тащим в hot-path парсинга таблиц
		// (и так вернём 0)
		_ = err
		return 0
	}
	return f
}

func sortDriverSeasonResults(out []models.DriverSeasonResult, eventStartByID map[string]time.Time) {
	sort.SliceStable(out, func(i, j int) bool {
		ti, okI := eventStartByID[out[i].EventID]
		tj, okJ := eventStartByID[out[j].EventID]
		if okI && okJ && !ti.Equal(tj) {
			return ti.Before(tj)
		}
		// Для F1 внутри одного event_id: Sprint перед Feature.
		if strings.EqualFold(out[i].SeriesID, "F1") && out[i].EventID == out[j].EventID {
			rank := func(r models.DriverSeasonResult) int {
				if strings.Contains(strings.ToLower(strings.TrimSpace(r.RaceName)), "sprint") {
					return 0
				}
				return 1
			}
			ri, rj := rank(out[i]), rank(out[j])
			if ri != rj {
				return ri < rj
			}
		}
		// Стабильность: если даты одинаковые/неизвестные — сортируем по названию.
		if out[i].EventName != out[j].EventName {
			return out[i].EventName < out[j].EventName
		}
		return out[i].RaceName < out[j].RaceName
	})
}
