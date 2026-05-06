// Package main provides a local debug helper.
package main

import (
	"fmt"

	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/schedulefile"
)

func main() {
	dataDir := appenv.ResolveDataDir("")
	fmt.Println("DataDir:", dataDir)
	d, err := schedulefile.LoadEventDetail(dataDir, "NOAPS_2026_4")
	if err != nil {
		fmt.Println("LoadEventDetail error:", err)
		return
	}
	if d == nil || d.Tables == nil {
		fmt.Println("detail or tables is nil")
		return
	}
	fmt.Println("tables keys:")
	for k := range d.Tables {
		fmt.Println(" -", k)
	}
	if rr, ok := d.Tables["race_results"]; ok {
		fmt.Println("race_results headers:", rr.Headers)
		fmt.Println("race_results rows:", len(rr.Rows))
	} else {
		fmt.Println("no race_results table")
	}
}

