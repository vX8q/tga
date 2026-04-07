// fetch-driver-wikidata заполняет nationality и birth_date у пилотов в БД данными из Wikidata.
// Сначала подтягивает в БД всех пилотов всех чемпионатов с сайта (из JSON: расписания, события, standings, stats),
// затем для каждого уникального имени запрашивает Wikidata и обновляет записи.
//
// Запуск: из корня проекта, с настроенным TGA_DATA или из каталога с data/:
//
//	go run ./cmd/fetch-driver-wikidata
//
// Соблюдает задержку ~1.2 с между запросами к API (правила Wikidata для анонимных запросов).
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/driverutil"
	"github.com/vX8q/tga/internal/schedulefile"
	"github.com/vX8q/tga/internal/store"
	"github.com/vX8q/tga/internal/tableutil"
	"github.com/vX8q/tga/models"
)

const (
	wikidataAPI  = "https://www.wikidata.org/w/api.php"
	delay        = 1200 * time.Millisecond
	wikiUserAgent = "TGA/1.0 (https://github.com/vX8q/tga; fetch driver info from Wikidata)"
)

func main() {
	dataDir := appenv.ResolveDataDir("")
	dbPath := filepath.Join(dataDir, "tga.sqlite")
	st, err := store.NewSQLiteStore(dbPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	ctx := context.Background()

	// 1) Собираем пилотов из всех чемпионатов (JSON) и добавляем в БД, если ещё нет.
	existingIDs := make(map[string]bool)
	drivers, err := st.ListDrivers(ctx)
	if err != nil {
		log.Fatalf("list drivers: %v", err)
	}
	for _, d := range drivers {
		existingIDs[d.ID] = true
	}
	log.Printf("drivers in DB before sync: %d", len(drivers))

	added := syncDriversFromChampionships(ctx, st, dataDir, existingIDs)
	log.Printf("synced %d new drivers from championships", added)

	drivers, err = st.ListDrivers(ctx)
	if err != nil {
		log.Fatalf("list drivers: %v", err)
	}
	log.Printf("drivers in DB: %d", len(drivers))

	// 2) Группируем по нормализованному имени — один запрос к Wikidata на имя.
	byName := make(map[string][]*models.Driver)
	for i := range drivers {
		d := &drivers[i]
		name := strings.TrimSpace(d.Name)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		byName[key] = append(byName[key], d)
	}
	log.Printf("unique driver names: %d", len(byName))

	client := &http.Client{Timeout: 15 * time.Second}
	labelCache := make(map[string]string) // Q-id -> label (country, place, region)
	placeLabels := make(map[string]string) // place Q-id -> full "City, Region, Country"
	updated := 0
	skipped := 0
	idx := 0
	var problems []struct{ Name, Reason string }

	for _, group := range byName {
		idx++
		time.Sleep(delay)
		name := group[0].Name
		qid, err := searchWikidata(ctx, client, name)
		if err != nil {
			log.Printf("[%d] %q search: %v", idx, name, err)
			problems = append(problems, struct{ Name, Reason string }{name, "поиск Wikidata: " + err.Error()})
			skipped += len(group)
			continue
		}
		if qid == "" {
			problems = append(problems, struct{ Name, Reason string }{name, "в Wikidata не найден"})
			skipped += len(group)
			continue
		}
		birth, countryID, placeID, err := getClaims(ctx, client, qid)
		if err != nil {
			log.Printf("[%d] %q claims: %v", idx, name, err)
			problems = append(problems, struct{ Name, Reason string }{name, "ошибка загрузки утверждений: " + err.Error()})
			skipped += len(group)
			continue
		}
		nationality := ""
		if countryID != "" {
			if lab, ok := labelCache[countryID]; ok {
				nationality = lab
			} else {
				lab, err := getLabel(ctx, client, countryID)
				if err == nil && lab != "" {
					labelCache[countryID] = lab
					nationality = lab
				}
				time.Sleep(delay)
			}
		}
		birthPlace := ""
		if placeID != "" {
			if full, ok := placeLabels[placeID]; ok {
				birthPlace = full
			} else {
				full := getBirthPlaceFull(ctx, client, placeID, labelCache, delay)
				if full != "" {
					placeLabels[placeID] = full
					birthPlace = full
				}
				time.Sleep(delay)
			}
		}
		if birth.IsZero() && nationality == "" && birthPlace == "" {
			problems = append(problems, struct{ Name, Reason string }{name, "нет даты рождения, гражданства и места рождения в Wikidata"})
			skipped += len(group)
			continue
		}
		for _, d := range group {
			upd := models.Driver{
				ID:          d.ID,
				Name:        d.Name,
				ShortName:   d.ShortName,
				Nationality: nationality,
				Number:      d.Number,
				BirthDate:   birth,
				BirthPlace:  birthPlace,
			}
			if err := st.UpsertDriver(ctx, &upd); err != nil {
				log.Printf("[%d] %q upsert: %v", idx, name, err)
				problems = append(problems, struct{ Name, Reason string }{name, "ошибка записи в БД: " + err.Error()})
				skipped++
				continue
			}
			updated++
		}
		log.Printf("[%d] %q -> birth=%s nationality=%s birth_place=%s (%d rows)", idx, name, formatDate(birth), nationality, birthPlace, len(group))
	}

	log.Printf("done: updated=%d skipped=%d", updated, skipped)
	if len(problems) > 0 {
		log.Printf("--- Проблемы (%d) ---", len(problems))
		for _, p := range problems {
			log.Printf("  %q: %s", p.Name, p.Reason)
		}
	}
}

// collectDriverNames из одного чемпионата: события (race_results, entry_list), standings, stats.
func collectDriverNames(dataDir, champID string) map[string]bool {
	names := make(map[string]bool)
	dataID := config.DataSeriesID(champID)

	events, err := schedulefile.LoadEvents(dataDir, dataID)
	if err != nil {
		log.Printf("collectDriverNames %s: LoadEvents: %v", champID, err)
	}
	if len(events) == 0 {
		// standings и stats могут быть без расписания
	}
	for _, ev := range events {
		detail, err := schedulefile.LoadEventDetail(dataDir, ev.ID)
		if err != nil || detail == nil || detail.Tables == nil {
			continue
		}
		for _, tbl := range detail.Tables {
			ci := tableutil.FirstColIndex(tbl.Headers, "Driver", "Drivers")
			if ci < 0 {
				continue
			}
			for _, row := range tbl.Rows {
				if ci < len(row) {
					cell := strings.TrimSpace(row[ci])
					for _, n := range strings.Split(cell, "/") {
						n = strings.TrimSpace(n)
						if n != "" {
							names[n] = true
						}
					}
				}
			}
		}
		for _, row := range detail.EntryList {
			n := strings.TrimSpace(row.Driver)
			if n != "" {
				names[n] = true
			}
		}
	}

	if standings, err := schedulefile.BuildStandingsFromEvents(dataDir, dataID, ""); err == nil && standings != nil {
		for _, r := range standings.Rows {
			n := strings.TrimSpace(r.Driver)
			if n != "" {
				names[n] = true
			}
		}
		for _, r := range standings.Ineligible {
			n := strings.TrimSpace(r.Driver)
			if n != "" {
				names[n] = true
			}
		}
	}
	if stats, err := schedulefile.BuildDriverStatsFromEvents(dataDir, dataID, config.CurrentSeason); err == nil && stats != nil {
		for _, r := range stats.Rows {
			n := strings.TrimSpace(r.Driver)
			if n != "" {
				names[n] = true
			}
		}
	}
	return names
}

// syncDriversFromChampionships добавляет в БД пилотов из всех чемпионатов (JSON), которых ещё нет.
func syncDriversFromChampionships(ctx context.Context, st store.Store, dataDir string, existingIDs map[string]bool) int {
	added := 0
	for _, c := range config.Championships {
		names := collectDriverNames(dataDir, c.ID)
		for name := range names {
			driverID := driverutil.MakeDriverID(c.ID, name, "")
			if existingIDs[driverID] {
				continue
			}
			if err := st.UpsertDriver(ctx, &models.Driver{ID: driverID, Name: name}); err != nil {
				log.Printf("sync upsert %q: %v", name, err)
				continue
			}
			existingIDs[driverID] = true
			added++
		}
	}
	return added
}

func formatDate(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02")
}

func wikiGet(ctx context.Context, client *http.Client, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", wikiUserAgent)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("wikidata HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

func searchWikidata(ctx context.Context, client *http.Client, name string) (string, error) {
	u := wikidataAPI + "?action=wbsearchentities&search=" + url.QueryEscape(name) + "&language=en&format=json"
	resp, err := wikiGet(ctx, client, u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		Search []struct {
			ID          string `json:"id"`
			Description string `json:"description"`
		} `json:"search"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	for _, s := range data.Search {
		desc := strings.ToLower(s.Description)
		if strings.Contains(desc, "racing") || strings.Contains(desc, "driver") ||
			strings.Contains(desc, "nascar") || strings.Contains(desc, "motorsport") ||
			strings.Contains(desc, "pilot") {
			return s.ID, nil
		}
	}
	if len(data.Search) > 0 {
		return data.Search[0].ID, nil
	}
	return "", nil
}

func getClaims(ctx context.Context, client *http.Client, qid string) (birth time.Time, countryID, placeID string, err error) {
	u := wikidataAPI + "?action=wbgetentities&ids=" + url.QueryEscape(qid) + "&props=claims&format=json"
	resp, err := wikiGet(ctx, client, u)
	if err != nil {
		return time.Time{}, "", "", err
	}
	defer resp.Body.Close()
	var data struct {
		Entities map[string]struct {
			Claims map[string][]struct {
				Mainsnak struct {
					Snaktype  string `json:"snaktype"`
					Datavalue *struct {
						Value interface{} `json:"value"`
						Type  string     `json:"type"`
					} `json:"datavalue"`
				} `json:"mainsnak"`
			} `json:"claims"`
		} `json:"entities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return time.Time{}, "", "", err
	}
	ent, ok := data.Entities[qid]
	if !ok {
		return time.Time{}, "", "", fmt.Errorf("entity %s not found", qid)
	}
	// P569 = date of birth
	if list, ok := ent.Claims["P569"]; ok && len(list) > 0 && list[0].Mainsnak.Datavalue != nil {
		if v, ok := list[0].Mainsnak.Datavalue.Value.(map[string]interface{}); ok {
			if t, ok := v["time"].(string); ok {
				t = strings.TrimPrefix(t, "+")
				if idx := strings.Index(t, "T"); idx > 0 {
					t = t[:idx]
				}
				birth, _ = time.Parse("2006-01-02", t)
			}
		}
	}
	// P27 = country of citizenship
	if list, ok := ent.Claims["P27"]; ok && len(list) > 0 && list[0].Mainsnak.Datavalue != nil {
		if v, ok := list[0].Mainsnak.Datavalue.Value.(map[string]interface{}); ok {
			if id, ok := v["id"].(string); ok {
				countryID = id
			}
		}
	}
	// P19 = place of birth
	if list, ok := ent.Claims["P19"]; ok && len(list) > 0 && list[0].Mainsnak.Datavalue != nil {
		if v, ok := list[0].Mainsnak.Datavalue.Value.(map[string]interface{}); ok {
			if id, ok := v["id"].(string); ok {
				placeID = id
			}
		}
	}
	return birth, countryID, placeID, nil
}

// getPlaceClaims возвращает P131 (located in / регион) и P17 (country) для места рождения.
func getPlaceClaims(ctx context.Context, client *http.Client, placeID string) (regionID, countryID string, err error) {
	u := wikidataAPI + "?action=wbgetentities&ids=" + url.QueryEscape(placeID) + "&props=claims&format=json"
	resp, err := wikiGet(ctx, client, u)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var data struct {
		Entities map[string]struct {
			Claims map[string][]struct {
				Mainsnak struct {
					Datavalue *struct {
						Value interface{} `json:"value"`
					} `json:"datavalue"`
				} `json:"mainsnak"`
			} `json:"claims"`
		} `json:"entities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}
	ent, ok := data.Entities[placeID]
	if !ok {
		return "", "", nil
	}
	// P131 = located in the administrative territorial entity (штат/регион)
	if list, ok := ent.Claims["P131"]; ok && len(list) > 0 && list[0].Mainsnak.Datavalue != nil {
		if v, ok := list[0].Mainsnak.Datavalue.Value.(map[string]interface{}); ok {
			if id, ok := v["id"].(string); ok {
				regionID = id
			}
		}
	}
	// P17 = country
	if list, ok := ent.Claims["P17"]; ok && len(list) > 0 && list[0].Mainsnak.Datavalue != nil {
		if v, ok := list[0].Mainsnak.Datavalue.Value.(map[string]interface{}); ok {
			if id, ok := v["id"].(string); ok {
				countryID = id
			}
		}
	}
	return regionID, countryID, nil
}

// getBirthPlaceFull возвращает место рождения в формате "Город, Регион/штат, Страна" (например Corning, California, U.S.).
func getBirthPlaceFull(ctx context.Context, client *http.Client, placeID string, labelCache map[string]string, delay time.Duration) string {
	regionID, countryID, err := getPlaceClaims(ctx, client, placeID)
	if err != nil {
		return ""
	}
	getCachedLabel := func(qid string) string {
		if qid == "" {
			return ""
		}
		if lab, ok := labelCache[qid]; ok {
			return lab
		}
		time.Sleep(delay)
		lab, _ := getLabel(ctx, client, qid)
		if lab != "" {
			labelCache[qid] = lab
		}
		return lab
	}
	city := getCachedLabel(placeID)
	region := getCachedLabel(regionID)
	country := getCachedLabel(countryID)
	return formatBirthPlace(city, region, country)
}

// formatBirthPlace собирает строку "Город, Регион, Страна"; сокращает United States -> U.S.
func formatBirthPlace(city, region, country string) string {
	city = strings.TrimSpace(city)
	region = strings.TrimSpace(region)
	country = strings.TrimSpace(country)
	if country == "United States of America" || country == "United States" {
		country = "U.S."
	}
	var parts []string
	if city != "" {
		parts = append(parts, city)
	}
	if region != "" {
		parts = append(parts, region)
	}
	if country != "" {
		parts = append(parts, country)
	}
	return strings.Join(parts, ", ")
}

func getLabel(ctx context.Context, client *http.Client, qid string) (string, error) {
	u := wikidataAPI + "?action=wbgetentities&ids=" + url.QueryEscape(qid) + "&props=labels&languages=en&format=json"
	resp, err := wikiGet(ctx, client, u)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		Entities map[string]struct {
			Labels struct {
				En struct {
					Value string `json:"value"`
				} `json:"en"`
			} `json:"labels"`
		} `json:"entities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if ent, ok := data.Entities[qid]; ok {
		return ent.Labels.En.Value, nil
	}
	return "", nil
}
