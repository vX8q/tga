// Package main provides a local debug helper.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
)

type dupInfo struct {
	Driver string
	Car    string
	Count  int
}

func main() {
	dataDir := appenv.ResolveDataDir("")
	dbPath := filepath.Join(dataDir, "tga.sqlite")

	var sqlStore *store.SQLiteStore
	if st, err := store.NewSQLiteStore(dbPath); err == nil {
		sqlStore = st
		defer func() { _ = sqlStore.Close() }()
	} else {
		fmt.Fprintf(os.Stderr, "WARN: failed to open DB at %s: %v\n", dbPath, err)
	}

	fmt.Printf("DataDir: %s\n", dataDir)
	fmt.Printf("DB: %s (opened=%v)\n\n", dbPath, sqlStore != nil)

	for _, c := range config.Championships {
		seriesID := c.ID
		dataSeriesID := config.DataSeriesID(seriesID)
		season := strings.TrimSpace(c.Season)
		if season == "" {
			season = config.CurrentSeason
		}

		var (
			data *schedulefile.DriverStatsData
			err  error
		)

		if sqlStore != nil {
			data, err = schedulefile.BuildDriverStatsFromDB(sqlStore.DB(), dataDir, dataSeriesID, season)
		}
		if data == nil || err != nil {
			data, err = schedulefile.BuildDriverStatsFromEvents(dataDir, dataSeriesID, season)
		}
		if err != nil {
			fmt.Printf("[%s] ERROR building stats (dataSeries=%s, season=%s): %v\n", seriesID, dataSeriesID, season, err)
			continue
		}
		if data == nil || len(data.Rows) == 0 {
			fmt.Printf("[%s] no stats rows (dataSeries=%s, season=%s)\n", seriesID, dataSeriesID, season)
			continue
		}

		dups := findDuplicates(data.Rows)
		if len(dups) == 0 {
			continue
		}

		fmt.Printf("[%s] duplicates (dataSeries=%s, season=%s):\n", seriesID, dataSeriesID, season)
		sort.Slice(dups, func(i, j int) bool {
			if dups[i].Driver != dups[j].Driver {
				return dups[i].Driver < dups[j].Driver
			}
			if dups[i].Car != dups[j].Car {
				return dups[i].Car < dups[j].Car
			}
			return dups[i].Count > dups[j].Count
		})
		for _, d := range dups {
			labelCar := d.Car
			if labelCar == "" {
				labelCar = "(no car)"
			}
			fmt.Printf("  - %s, #%s — %d rows\n", d.Driver, labelCar, d.Count)
		}
		fmt.Println()
	}
}

// findDuplicates ищет дублирующиеся строки статистики по ИМЕНИ пилота.
// Ключом считаем просто строку driver (с trim), без учёта номера машины.
func findDuplicates(rows []schedulefile.DriverStatsRow) []dupInfo {
	if len(rows) == 0 {
		return nil
	}
	type key struct {
		Driver string
	}
	counts := make(map[key]int)
	meta := make(map[key]dupInfo)
	for _, r := range rows {
		driverRaw := strings.TrimSpace(r.Driver)
		if driverRaw == "" {
			continue
		}
		k := key{Driver: driverRaw}
		counts[k]++
		if _, ok := meta[k]; !ok {
			meta[k] = dupInfo{
				Driver: driverRaw,
				Car:    strings.TrimSpace(r.Car),
				Count:  0, // заполним позже
			}
		}
	}
	var out []dupInfo
	for k, n := range counts {
		if n <= 1 {
			continue
		}
		info := meta[k]
		info.Count = n
		out = append(out, info)
	}
	return out
}

