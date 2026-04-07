package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/vX8q/tga/internal/appenv"
)

// normalizeEventTables загружает raw JSON события, приводит все значения в tables.*.rows к строкам
// и перезаписывает файл. Это нужно для совместимости с EventDetailJSON, где rows ожидаются как []string.
func normalizeEventTables(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var root map[string]interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	tablesAny, ok := root["tables"]
	if !ok {
		// ничего не делаем
		return nil
	}
	tables, ok := tablesAny.(map[string]interface{})
	if !ok {
		return fmt.Errorf("tables is not object")
	}
	for name, tblAny := range tables {
		tbl, ok := tblAny.(map[string]interface{})
		if !ok {
			continue
		}
		rowsAny, ok := tbl["rows"]
		if !ok {
			continue
		}
		rowsSlice, ok := rowsAny.([]interface{})
		if !ok {
			continue
		}
		var newRows [][]string
		for _, rAny := range rowsSlice {
			rowSlice, ok := rAny.([]interface{})
			if !ok {
				continue
			}
			rowStrs := make([]string, len(rowSlice))
			for i, cell := range rowSlice {
				switch v := cell.(type) {
				case string:
					rowStrs[i] = strings.TrimSpace(v)
				default:
					// приводим всё остальное к строке
					rowStrs[i] = strings.TrimSpace(fmt.Sprint(v))
				}
			}
			newRows = append(newRows, rowStrs)
		}
		tbl["rows"] = newRows
		tables[name] = tbl
	}
	root["tables"] = tables
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0o644)
}

func main() {
	dataDir := appenv.ResolveDataDir("")
	eventsDir := filepath.Join(dataDir, "events")
	targets := []string{
		filepath.Join(eventsDir, "noaps_2026_4.json"),
	}
	for _, p := range targets {
		fmt.Println("Normalizing", p)
		if err := normalizeEventTables(p); err != nil {
			fmt.Println("  ERROR:", err)
		} else {
			fmt.Println("  OK")
		}
	}
}

