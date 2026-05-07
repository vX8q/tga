// Command: compare NASCAR Cup 2026 standings built from event JSON vs reference (NASCAR.com snapshot).
// Usage: go run ./cmd/nascar-cup-standings-verify [-data dir]
package main

import (
	"encoding/csv"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/vX8q/tga/internal/schedulefile"
)

type refDriver struct {
	Points  int
	Stages  *int // nil = do not compare stages
	Races   map[string]string
}

type refFile struct {
	RaceOrder []string
	Drivers   map[string]refDriver
	Aliases   map[string]string
}

func main() {
	dataDir := flag.String("data", filepath.Join("data"), "data directory (contains events/, standings/)")
	refPath := flag.String("ref", filepath.Join("data", "reference", "nascar_cup_2026_nascar_com.tsv"), "reference TSV (or .json)")
	dumpBuilt := flag.Bool("dump-built-tsv", false, "print built standings as TSV (driver, points, stages, DAY..TEX) and exit")
	flag.Parse()

	absData, err := filepath.Abs(*dataDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "data dir: %v\n", err)
		os.Exit(1)
	}
	refAbs, err := filepath.Abs(*refPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ref: %v\n", err)
		os.Exit(1)
	}

	data, err := schedulefile.BuildStandingsFromEvents(absData, "NASCAR_CUP", "2026")
	if err != nil || data == nil {
		fmt.Fprintf(os.Stderr, "build standings: %v\n", err)
		os.Exit(1)
	}
	schedulefile.EnsureCompletedRaces(absData, "NASCAR_CUP", data)
	if len(data.Rows) > 0 {
		schedulefile.EnrichStagesFromEvents(absData, "NASCAR_CUP", data)
	}

	if *dumpBuilt {
		ro := data.RaceOrder
		if len(ro) > 11 {
			ro = ro[:11]
		}
		fmt.Printf("driver\tpoints\tstages\t%s\n", strings.Join(ro, "\t"))
		for _, row := range data.Rows {
			cells := []string{row.Driver, row.Points, row.Stages}
			for _, code := range ro {
				v := ""
				if row.Races != nil {
					v = row.Races[code]
				}
				cells = append(cells, v)
			}
			fmt.Println(strings.Join(cells, "\t"))
		}
		return
	}

	ref, err := loadReference(refAbs)
	if err != nil {
		fmt.Fprintf(os.Stderr, "reference: %v\n", err)
		os.Exit(1)
	}

	alias := map[string]string{}
	for k, v := range ref.Aliases {
		alias[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
	}

	refByCanon := make(map[string]refDriver)
	for name, row := range ref.Drivers {
		key := canonDriver(name)
		refByCanon[key] = row
	}

	leadNum := regexp.MustCompile(`^(\d+)`)

	normalizeRaceCell := func(s string) string {
		s = strings.TrimSpace(s)
		if s == "" || s == "—" || s == "-" {
			return ""
		}
		low := strings.ToLower(s)
		if strings.HasPrefix(low, "dnq") {
			return "DNQ"
		}
		if strings.HasPrefix(low, "wth") {
			return "WTH"
		}
		if m := leadNum.FindStringSubmatch(s); len(m) > 1 {
			return m[1]
		}
		return s
	}

	parsePts := func(s string) int {
		s = strings.TrimSpace(s)
		if s == "" || s == "—" || s == "-" {
			return 0
		}
		n := 0
		for _, c := range s {
			if c >= '0' && c <= '9' {
				n = n*10 + int(c-'0')
			}
		}
		return n
	}

	var issues []string
	matched := 0

	for _, row := range data.Rows {
		d := strings.TrimSpace(row.Driver)
		lookup := d
		if a, ok := alias[strings.ToLower(d)]; ok {
			lookup = a
		}
		want, ok := refByCanon[canonDriver(lookup)]
		if !ok {
			issues = append(issues, fmt.Sprintf("NOTE (no row in NASCAR.com TSV — part-time / omitted): %q", d))
			continue
		}
		matched++
		gotPts := parsePts(row.Points)
		if gotPts != want.Points {
			issues = append(issues, fmt.Sprintf("POINTS %q: got %d want %d", d, gotPts, want.Points))
		}
		if want.Stages != nil {
			gotSt := parsePts(row.Stages)
			if gotSt != *want.Stages {
				issues = append(issues, fmt.Sprintf("STAGES %q: got %d want %d", d, gotSt, *want.Stages))
			}
		}
		if len(want.Races) > 0 && row.Races != nil {
			for code, wantCell := range want.Races {
				gotCell := row.Races[code]
				w := normalizeRaceCell(wantCell)
				g := normalizeRaceCell(gotCell)
				if w != g {
					issues = append(issues, fmt.Sprintf("RACE %s %q: got %q (%q) want %q (%q)", code, d, gotCell, g, wantCell, w))
				}
			}
		}
	}

	// Reference drivers not present in built (e.g. part-time not in top 38)
	builtCanon := make(map[string]bool)
	for _, row := range data.Rows {
		builtCanon[canonDriver(row.Driver)] = true
	}
	for name := range ref.Drivers {
		k := canonDriver(name)
		if !builtCanon[k] {
			issues = append(issues, fmt.Sprintf("MISSING in built standings (reference only): %q", name))
		}
	}

	fmt.Printf("Compared %d drivers with reference. Race codes: %v\n", matched, ref.RaceOrder)
	var hard, notes []string
	for _, s := range issues {
		if strings.HasPrefix(s, "NOTE ") {
			notes = append(notes, s)
			continue
		}
		hard = append(hard, s)
	}
	for _, s := range notes {
		fmt.Println(s)
	}
	if len(hard) == 0 {
		if len(notes) > 0 {
			fmt.Println("\nOK: no points/stage/race mismatches vs reference (see NOTE lines above).")
		} else {
			fmt.Println("OK: no discrepancies.")
		}
		return
	}
	fmt.Printf("\n%d mismatch(es) vs NASCAR.com reference:\n", len(hard))
	for _, s := range hard {
		fmt.Println(s)
	}
	os.Exit(1)
}

func loadReference(refAbs string) (refFile, error) {
	var out refFile
	b, err := os.ReadFile(refAbs)
	if err != nil {
		return out, err
	}
	if strings.HasSuffix(strings.ToLower(refAbs), ".json") {
		type jsonRef struct {
			RaceOrder []string            `json:"race_order"`
			Drivers   map[string]refDriver `json:"drivers"`
			Aliases   map[string]string   `json:"aliases,omitempty"`
		}
		var jr jsonRef
		if err := json.Unmarshal(b, &jr); err != nil {
			return out, err
		}
		out.RaceOrder = jr.RaceOrder
		out.Drivers = jr.Drivers
		out.Aliases = jr.Aliases
		return out, nil
	}
	// TSV: driver, points, stages, DAY, ATL, ... (11 races)
	r := csv.NewReader(strings.NewReader(string(b)))
	r.Comma = '\t'
	r.LazyQuotes = true
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return out, err
	}
	if len(header) < 4 {
		return out, fmt.Errorf("tsv header too short")
	}
	out.RaceOrder = header[3:]
	out.Drivers = make(map[string]refDriver)
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return out, err
		}
		if len(rec) < 3 {
			continue
		}
		name := strings.TrimSpace(rec[0])
		if name == "" || strings.EqualFold(name, "driver") {
			continue
		}
		pts, _ := strconv.Atoi(strings.TrimSpace(rec[1]))
		stRaw := strings.TrimSpace(rec[2])
		var stPtr *int
		if stRaw != "" && stRaw != "—" && stRaw != "-" {
			n, _ := strconv.Atoi(stRaw)
			stPtr = &n
		} else {
			z := 0
			stPtr = &z
		}
		races := make(map[string]string)
		for i, code := range out.RaceOrder {
			idx := 3 + i
			if idx < len(rec) {
				races[code] = strings.TrimSpace(rec[idx])
			}
		}
		out.Drivers[name] = refDriver{Points: pts, Stages: stPtr, Races: races}
	}
	return out, nil
}

func foldAccents(s string) string {
	repl := strings.NewReplacer(
		"á", "a", "Á", "a", "à", "a", "À", "a", "ä", "a", "Ä", "a",
		"é", "e", "É", "e", "è", "e", "È", "e", "ë", "e",
		"í", "i", "Í", "i", "ì", "i", "ï", "i",
		"ó", "o", "Ó", "o", "ò", "o", "ö", "o",
		"ú", "u", "Ú", "u", "ù", "u", "ü", "u",
		"ñ", "n", "Ñ", "n",
		"ç", "c", "Ç", "c",
		"š", "s", "Š", "s", "ž", "z", "Ž", "z",
		"ů", "u", "Ů", "u",
	)
	return repl.Replace(s)
}

func canonDriver(s string) string {
	s = strings.TrimSpace(foldAccents(s))
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
