package schedulefile

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// eventSeriesFolderNames — папка серии в data/events (внутри — папки сезонов 2025, 2026 и т.д.).
// Все чемпионаты из config: по slug (data series id) задано имя папки для структуры Серия/Год.
var eventSeriesFolderNames = map[string]string{
	"f1": "F1", "f2": "F2", "f3": "F3", "frec": "FREC", "f4_it": "Italian F4", "smp_f4_ru": "SMP F4 Russia", "psc": "Porsche Supercup",
	"nascar_cup": "NASCAR Cup Series", "nascar_truck": "NASCAR Truck", "nascar_modified": "NASCAR Modified", "arca": "ARCA", "noaps": "NOAPS",
	"indycar": "IndyCar", "super_formula": "Super Formula",
	"supercars": "Supercars", "dtm": "DTM", "super_gt": "Super GT",
	"wec": "WEC", "elms": "ELMS", "imsa": "IMSA",
	"gtwce_end": "GT World Challenge Europe Endurance", "gtwce_sprint": "GT World Challenge Europe Sprint",
}

// saveJSONFile сериализует структуру в JSON и сохраняет в указанный путь.
func saveJSONFile(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// stripBOM removes a UTF-8 BOM prefix (EF BB BF) if present.
func stripBOM(b []byte) []byte {
	if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
		return b[3:]
	}
	return b
}

// readFileIfExists читает файл и различает отсутствие файла и другие ошибки.
func readFileIfExists(path string) ([]byte, error) {
	b, err := os.ReadFile(path) //nolint:gosec
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return stripBOM(b), nil
}

// eventsPath возвращает путь к файлу с расписанием серии.
func eventsPath(dataDir, seriesID string) string {
	return filepath.Join(dataDir, "schedules", strings.ToLower(seriesID)+".json")
}

// standingsPath возвращает путь к файлу standings серии.
func standingsPath(dataDir, seriesID string) string {
	return filepath.Join(dataDir, "standings", strings.ToLower(seriesID)+".json")
}

// teamsPath возвращает путь к файлу teams серии.
func teamsPath(dataDir, seriesID string) string {
	return filepath.Join(dataDir, "teams", strings.ToLower(seriesID)+".json")
}

// eventDetailPath возвращает путь к файлу деталей события (плоский каталог).
func eventDetailPath(dataDir, eventID string) string {
	return filepath.Join(dataDir, "events", strings.ToLower(eventID)+".json")
}

var eventIDSeriesYearRe = regexp.MustCompile(`^([a-z0-9_]+)_(20\d{2})_`)

// eventDetailPathCandidates возвращает пути к JSON события в порядке проверки:
// сначала data/events/{Серия}/{Год}, затем плоский data/events.
func eventDetailPathCandidates(dataDir, eventID string) []string {
	idLower := strings.ToLower(eventID)
	flat := filepath.Join(dataDir, "events", idLower+".json")
	m := eventIDSeriesYearRe.FindStringSubmatch(idLower)
	if len(m) < 3 {
		return []string{flat}
	}
	series, year := m[1], m[2]
	folderName, ok := eventSeriesFolderNames[series]
	if !ok {
		return []string{flat}
	}
	subDir := filepath.Join(dataDir, "events", folderName, year, idLower+".json")
	return []string{subDir, flat}
}

// readEventDetailFile читает JSON события, проверяя data/events/{Серия}/{Год} и плоский каталог.
func readEventDetailFile(dataDir, eventID string) ([]byte, error) {
	return ReadEventDetailFile(dataDir, eventID)
}

// eventDetailFileIsPlaceholder — пустой или минимальный JSON, который не должен перекрывать полный файл ниже по списку путей.
func eventDetailFileIsPlaceholder(b []byte) bool {
	t := bytes.TrimSpace(stripBOM(b))
	if len(t) == 0 {
		return true
	}
	return bytes.Equal(t, []byte("{}")) || bytes.Equal(t, []byte("null"))
}

// ReadEventDetailFile — экспортируемая обёртка для HTTP-обработчика и других пакетов.
// Читает JSON события из data/events/{Серия}/{Год} или из плоского data/events.
func ReadEventDetailFile(dataDir, eventID string) ([]byte, error) {
	for _, path := range eventDetailPathCandidates(dataDir, eventID) {
		b, err := os.ReadFile(path) //nolint:gosec
		if err == nil {
			b = stripBOM(b)
			if eventDetailFileIsPlaceholder(b) {
				continue
			}
			return b, nil
		}
		if !os.IsNotExist(err) {
			return nil, err
		}
	}
	return nil, os.ErrNotExist
}

// EventDetailExists возвращает true, если JSON события есть в data/events/{Серия}/{Год} или в плоском каталоге.
func EventDetailExists(dataDir, eventID string) bool {
	for _, path := range eventDetailPathCandidates(dataDir, eventID) {
		b, err := os.ReadFile(path) //nolint:gosec
		if err == nil {
			if eventDetailFileIsPlaceholder(b) {
				continue
			}
			return true
		}
		if !os.IsNotExist(err) {
			return false
		}
	}
	return false
}

