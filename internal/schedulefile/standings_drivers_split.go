package schedulefile

import "strings"

// splitDriversCell разбивает значение ячейки с несколькими пилотами
// (формат endurance/Super GT: "Driver A; Driver B" или "A / B / C") на
// список имён. Пустые элементы и пробелы отбрасываются.
//
// Поддерживаемые разделители:
//   - ";"  (Super GT)
//   - "/"  (WEC/ELMS/IMSA)
//   - ","  (редко, страховка)
//
// Если разделителей нет, возвращает единственный элемент с исходной строкой
// (после TrimSpace). Пустая строка → пустой результат.
func splitDriversCell(raw string) []string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil
	}
	seps := []string{";", "/", ","}
	parts := []string{s}
	for _, sep := range seps {
		var next []string
		for _, p := range parts {
			for _, x := range strings.Split(p, sep) {
				x = strings.TrimSpace(x)
				if x != "" {
					next = append(next, x)
				}
			}
		}
		if len(next) > 0 {
			parts = next
		}
	}
	// Финальная очистка от пустых значений.
	out := parts[:0]
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, dup := seen[p]; dup {
			// В одной гонке пилот может быть указан дважды (редкая опечатка
			// в источнике) — считаем его один раз, чтобы не дублировать очки.
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

// driversFromRow возвращает список пилотов строки результатов, поддерживая
// как единичную колонку "Driver" (sprint-серии), так и колонку "Drivers"
// (endurance: WEC/ELMS/IMSA/Super GT/GTWC Endurance). Если обе колонки
// отсутствуют — возвращает nil. Для "Driver" возвращает одиночный элемент.
func driversFromRow(headers []string, row []string) []string {
	driverCol := colIndex(headers, "Driver")
	if driverCol >= 0 && driverCol < len(row) {
		name := strings.TrimSpace(row[driverCol])
		if name == "" {
			return nil
		}
		return []string{name}
	}
	driversCol := colIndex(headers, "Drivers")
	if driversCol >= 0 && driversCol < len(row) {
		return splitDriversCell(row[driversCol])
	}
	return nil
}

// pointsColIndex возвращает индекс колонки очков с учётом разных названий,
// используемых в разных сериях: "Points", "Pts", "Pts.", а также "DP" (Super GT,
// driver points — очки пилота, в отличие от "TP" для команды). Если колонка
// не найдена, возвращает -1.
func pointsColIndex(headers []string) int {
	candidates := []string{"Points", "Pts", "Pts.", "DP"}
	for _, c := range candidates {
		if i := colIndex(headers, c); i >= 0 {
			return i
		}
	}
	return -1
}
