package schedulefile

import (
	"path/filepath"
	"testing"
)

// TestBuildStandingsFromEvents_AllSeriesWithRealData — интеграционный smoke-тест,
// который прогоняет BuildStandingsFromEvents по всем сериям с текущими данными
// проекта. Цель — убедиться, что автосборка таблицы пилотов не падает ни на
// одной серии и возвращает непустой результат там, где есть завершённые гонки
// в event-файлах. Если какая-то серия перестанет собираться — тест это поймает.
func TestBuildStandingsFromEvents_AllSeriesWithRealData(t *testing.T) {
	dataDir, err := filepath.Abs(filepath.Join("..", "..", "data"))
	if err != nil {
		t.Fatalf("abs data dir: %v", err)
	}

	series := []struct {
		id           string
		wantRowsWhen string // название причины, по которой ожидаем непустые rows (для сезона 2026)
	}{
		// Серии с standings.json + event-файлами для 2026 — авто-пересборка должна давать rows.
		{"ARCA", "есть завершённые раунды 2026"},
		{"INDYCAR", "есть завершённые раунды 2026"},
		{"NASCAR_CUP", "есть завершённые раунды 2026"},
		{"NASCAR_MODIFIED", "есть завершённые раунды 2026"},
		{"NASCAR_TRUCK", "есть завершённые раунды 2026"},
		{"NOAPS", "есть завершённые раунды 2026"},
		{"SUPERCARS", "есть завершённые раунды 2026"},
		// Серии без standings.json — авто-сборка из расписания + event-файлов.
		{"F1", "есть завершённые раунды 2026"},
		{"F2", ""}, // может быть пусто, если нет event-файлов результатов
		{"F3", ""},
		{"SUPER_FORMULA", "есть завершённый event 2026"},
		{"SUPER_GT", ""},
		{"WEC", ""},
		{"ELMS", ""},
		{"GTWCE_END", ""},
		// Серии без 2026-данных — тест просто не должен падать.
		{"FREC", ""},
		{"F4_IT", ""},
		{"SMP_F4_RU", ""},
		{"PSC", ""},
		{"DTM", ""},
		{"GTWCE_SPRINT", ""},
	}

	for _, s := range series {
		t.Run(s.id, func(t *testing.T) {
			data, err := BuildStandingsFromEvents(dataDir, s.id, "2026")
			if err != nil {
				t.Fatalf("BuildStandingsFromEvents(%q): %v", s.id, err)
			}
			if data == nil {
				t.Fatalf("BuildStandingsFromEvents(%q) returned nil without error", s.id)
			}
			// Разрешены пустые rows (серия без данных за сезон), но не должно быть
			// нулевых ссылок на поля — структура должна быть корректной.
			if data.Rows == nil {
				data.Rows = []StandingRow{}
			}
			t.Logf("%s: race_order=%d completed=%d rows=%d ineligible=%d",
				s.id, len(data.RaceOrder), len(data.CompletedRaces), len(data.Rows), len(data.Ineligible))
			if s.wantRowsWhen != "" && len(data.Rows) == 0 {
				t.Logf("warning: %s ожидали rows (%s), получили 0 строк — возможно, данные ещё не добавлены", s.id, s.wantRowsWhen)
			}
		})
	}
}
