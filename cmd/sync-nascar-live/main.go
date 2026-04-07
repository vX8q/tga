// sync-nascar-live запрашивает официальный NASCAR API (feed.nascar.com), определяет
// текущую live-гонку и обновляет data/live.json для отображения метки LIVE в приложении.
//
// Запуск: go run ./cmd/sync-nascar-live -data-dir=./data
// Рекомендуется вызывать по cron каждые 1–2 минуты во время гоночных уик-эндов.
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

	if err := livesync.SyncNASCAR(*dataDir); err != nil {
		log.Fatalf("sync-nascar-live: %v", err)
	}
}
