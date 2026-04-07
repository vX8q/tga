// sync-openf1-live опрашивает OpenF1 API (api.openf1.org), определяет текущую
// live-сессию (практика, квалификация, гонка) и обновляет data/live.json для F1.
// Не затирает остальные записи в live.json (NASCAR и т.д.) — только добавляет/убирает F1.
//
// Запуск: go run ./cmd/sync-openf1-live -data-dir=./data
// Рекомендуется по cron каждые 1–2 минуты в гоночные уик-энды F1.
// Либо синхронизация идёт автоматически при работе сервера (фоновый livesync).
package main

import (
	"flag"
	"log"

	"github.com/vX8q/tga/internal/livesync"
)

func main() {
	dataDir := flag.String("data-dir", "data", "каталог data (schedules, live.json)")
	flag.Parse()

	if err := livesync.SyncOpenF1(*dataDir); err != nil {
		log.Fatalf("sync-openf1-live: %v", err)
	}
}
