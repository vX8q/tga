package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/schedulefile"
)

// checkStandingsGaps печатает по каждой серии коды гонок, для которых
// ни у одного пилота нет значения (ячейка пуста / "—" / "-").
// Учитываем только реально завершённые гонки (completed_races), чтобы
// не ругаться на будущие этапы из race_order.
func checkStandingsGaps(dataDir string, seriesID string) error {
	data, err := schedulefile.BuildStandingsFromEvents(dataDir, seriesID, "")
	if err != nil {
		return fmt.Errorf("build standings for %s: %w", seriesID, err)
	}
	if data == nil || len(data.RaceOrder) == 0 || len(data.Rows) == 0 {
		fmt.Printf("[%s] no standings rows or empty race_order\n", strings.ToUpper(seriesID))
		return nil
	}

	// Если есть completed_races — проверяем только их, иначе проверяем весь race_order.
	codes := data.RaceOrder
	if len(data.CompletedRaces) > 0 {
		codes = data.CompletedRaces
	}

	var emptyCodes []string
	for _, code := range codes {
		hasVal := false
		for i := range data.Rows {
			if data.Rows[i].Races == nil {
				continue
			}
			v := strings.TrimSpace(data.Rows[i].Races[code])
			if v != "" && v != "—" && v != "-" {
				hasVal = true
				break
			}
		}
		if !hasVal {
			emptyCodes = append(emptyCodes, code)
		}
	}

	upID := strings.ToUpper(seriesID)
	if len(emptyCodes) == 0 {
		fmt.Printf("[%s] all race_order columns have at least one value\n", upID)
		return nil
	}
	fmt.Printf("[%s] empty standings columns (no values in any row):\n", upID)
	for _, code := range emptyCodes {
		fmt.Printf("  - %s\n", code)
	}
	return nil
}

func main() {
	dataDir := appenv.ResolveDataDir("")
	fmt.Printf("DataDir: %s\n", dataDir)
	if _, err := os.Stat(filepath.Join(dataDir, "standings")); err != nil {
		fmt.Fprintf(os.Stderr, "WARN: standings dir not found: %v\n", err)
	}

	stockSeries := []string{"nascar_cup", "noaps", "nascar_truck", "arca", "nascar_modified"}

	// На всякий случай сверим, что в конфиге есть такие серии.
	var known []string
	for _, c := range config.Championships {
		s := strings.ToLower(c.ID)
		for _, want := range stockSeries {
			if s == want {
				known = append(known, want)
			}
		}
	}
	fmt.Printf("Stock-car series to check (from config): %v\n\n", known)

	for _, s := range stockSeries {
		if err := checkStandingsGaps(dataDir, s); err != nil {
			fmt.Fprintf(os.Stderr, "[%s] ERROR: %v\n", strings.ToUpper(s), err)
		}
		fmt.Println()
	}
}

