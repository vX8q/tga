package main

import (
	"fmt"

	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/schedulefile"
)

func main() {
	dataDir := appenv.ResolveDataDir("")
	fmt.Println("DataDir:", dataDir)

	data, err := schedulefile.BuildStandingsFromEvents(dataDir, "noaps", "")
	if err != nil {
		fmt.Println("ERROR:", err)
		return
	}
	if data == nil {
		fmt.Println("no data")
		return
	}
	fmt.Println("race_order:", data.RaceOrder)
	fmt.Println("completed_races:", data.CompletedRaces)

	// Печатаем первые 10 пилотов и их значения по ключам DAY/ATL/COA/PHO.
	keys := []string{"DAY", "ATL", "COA", "PHO"}
	for i := 0; i < len(data.Rows) && i < 10; i++ {
		r := data.Rows[i]
		fmt.Printf("%2d. %s\n", r.Pos, r.Driver)
		for _, k := range keys {
			val := ""
			if r.Races != nil {
				val = r.Races[k]
			}
			fmt.Printf("   %s: %q\n", k, val)
		}
	}
}

