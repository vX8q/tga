package schedulefile

import (
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
		}
	}

	// Сортировка: сначала по времени старта события, затем по названию гонки (стабильность).
	sortDriverSeasonResults(out, eventStartByID)
	return out, nil
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

	colDriver := colIndex(headers, "Driver")
	colNo := firstColIndex(headers, "No", "No.", "#", "Car")

	colLaps := colIndex(headers, "Laps")

	colPoints := firstColIndex(headers,
		"Points", "Points.",
		"Pts", "Pts.", "Pts..",
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

		if !strings.EqualFold(driverutil.Slug(driver), driverSlug) {
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
		out = append(out, models.DriverSeasonResult{
			SeriesID:   seriesID,
			SeriesName: seriesName,
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

