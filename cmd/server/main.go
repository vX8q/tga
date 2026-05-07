package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/vX8q/tga/config"
	"github.com/vX8q/tga/internal/appenv"
	"github.com/vX8q/tga/internal/livesync"
	"github.com/vX8q/tga/internal/store"
)

func resolveWebDir(cfg Config) string {
	if cfg.WebDir != "" {
		if _, err := os.Stat(cfg.WebDir); err == nil {
			return cfg.WebDir
		}
	}
	webDir := "web"
	if _, err := os.Stat(webDir); err == nil {
		return webDir
	}
	exe, err := os.Executable()
	if err != nil {
		return webDir
	}
	dir := filepath.Dir(exe)
	for _, d := range []string{
		filepath.Join(dir, "web"),
		filepath.Join(dir, "..", "web"),
	} {
		if _, err := os.Stat(d); err == nil {
			return d
		}
	}
	return webDir
}

func main() {
	// Уровень логов из окружения (LOG_LEVEL=debug для отладки standings и т.д.)
	if levelStr := os.Getenv("LOG_LEVEL"); levelStr != "" {
		var level slog.Level
		if err := level.UnmarshalText([]byte(strings.ToLower(levelStr))); err == nil {
			h := slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})
			slog.SetDefault(slog.New(h))
			slog.Info("log level set from LOG_LEVEL", "level", level.String())
		}
	}

	cfg := LoadConfig()
	if err := cfg.Validate(); err != nil {
		slog.Error("invalid config", "err", err)
		os.Exit(1)
	}

	webDir := resolveWebDir(cfg)
	dataDir := appenv.ResolveDataDir(cfg.DataDir)
	slog.Info("startup", "data_dir", dataDir, "web_dir", webDir)

	var st store.Store = store.NoopStore{}
	dbPath := filepath.Join(dataDir, "tga.sqlite")
	if cfg.ResetDB {
		_ = os.Remove(dbPath)
	}
	if s, err := store.NewSQLiteStore(dbPath); err != nil {
		slog.Warn("SQLite init failed, using Noop store", "path", dbPath, "err", err)
	} else {
		st = s
		slog.Info("store", "driver", "sqlite", "path", dbPath)
		if c, ok := st.(*store.SQLiteStore); ok {
			defer func() { _ = c.Close() }()
		}
	}

	if err := bootstrapStoreFromFiles(st, dataDir); err != nil {
		slog.Error("bootstrap failed", "err", err)
		os.Exit(1)
	}

	// Контекст для остановки фоновых горутин при shutdown
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()
	// Фоновый livesync: NASCAR + OpenF1 каждые 2 минуты
	go livesync.StartBackground(appCtx, dataDir, 2*time.Minute)

	rateLimiter := newRateLimiter(cfg.RateLimitRPS, 2*int(cfg.RateLimitRPS)+1)
	if rateLimiter != nil {
		slog.Info("rate limit enabled", "rps", cfg.RateLimitRPS)
	}
	apiWrap := func(h http.HandlerFunc) http.HandlerFunc {
		return chain(h, wrapWithCORS, wrapWithRecovery, wrapWithTraceID, wrapWithRateLimit(rateLimiter), wrapWithLogging)
	}
	staticWrap := func(h http.HandlerFunc) http.HandlerFunc {
		return chain(h, wrapWithRecovery, wrapWithLogging)
	}

	fs := http.FileServer(http.Dir(webDir))
	http.HandleFunc("/web/", staticWrap(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/web/app.js" || r.URL.Path == "/web/style.css" {
			w.Header().Set("Cache-Control", "no-store, max-age=0")
		}
		http.StripPrefix("/web/", fs).ServeHTTP(w, r)
	}))
	http.HandleFunc("/favicon.ico", staticWrap(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/web/favicon.svg", http.StatusMovedPermanently)
	}))

	indexPath := filepath.Join(webDir, "index.html")
	http.HandleFunc("/event/", staticWrap(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, indexPath)
	}))

	http.HandleFunc("/", staticWrap(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimSpace(r.URL.Path)
		if p == "" {
			p = "/"
		}
		// /series/f1 (без подпути) → /series/f1/history: страница серии F1 — это
		// список всех сезонов. Текущее расписание сезона теперь живёт на
		// /season/f1-{CurrentSeason}.
		if p == "/series/f1" || p == "/series/f1/" {
			http.Redirect(w, r, "/series/f1/history", http.StatusMovedPermanently)
			return
		}
		if p == "/" || p == "/schedule" || strings.HasPrefix(p, "/search") || strings.HasPrefix(p, "/series") || strings.HasPrefix(p, "/season") || strings.HasPrefix(p, "/track") || strings.HasPrefix(p, "/driver") || strings.HasPrefix(p, "/team") || strings.HasPrefix(p, "/crew-chief") {
			http.ServeFile(w, r, indexPath)
			return
		}
		http.NotFound(w, r)
	}))

	http.Handle("/metrics", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		promhttp.Handler().ServeHTTP(w, r)
	}))

	if cfg.EnablePprof {
		slog.Info("pprof enabled under /debug/pprof")
		pprofWrap := func(h http.HandlerFunc) http.HandlerFunc {
			return wrapWithAdminToken(cfg.AdminToken, apiWrap(h))
		}
		http.HandleFunc("/debug/pprof/", pprofWrap(pprof.Index))
		http.HandleFunc("/debug/pprof/cmdline", pprofWrap(pprof.Cmdline))
		http.HandleFunc("/debug/pprof/profile", pprofWrap(pprof.Profile))
		http.HandleFunc("/debug/pprof/symbol", pprofWrap(pprof.Symbol))
		http.HandleFunc("/debug/pprof/trace", pprofWrap(pprof.Trace))
	}

	http.HandleFunc("/health", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, isNoop := st.(store.NoopStore); isNoop {
			w.WriteHeader(http.StatusServiceUnavailable)
			b, _ := json.Marshal(map[string]string{"status": "degraded", "error": "no database"})
			_, _ = w.Write(b)
			return
		}
		if err := st.Health(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			b, _ := json.Marshal(map[string]string{"status": "unavailable", "error": err.Error()})
			_, _ = w.Write(b)
			return
		}
		b, _ := json.Marshal(map[string]string{"status": "ok", "season": config.CurrentSeason})
		_, _ = w.Write(b)
	}))
	http.HandleFunc("/api/series", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleSeriesList(w, r, st)
	}))
	http.HandleFunc("/api/series/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleSeries(w, r, dataDir, st)
	}))
	http.HandleFunc("/api/events/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleEvent(w, r, dataDir, nil)
	}))
	http.HandleFunc("/api/live-events", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleLiveEvents(w, r, dataDir, st)
	}))
	http.HandleFunc("/api/driver/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleDriverBySlug(w, r, dataDir, st)
	}))
	http.HandleFunc("/api/drivers", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleDriversList(w, r, dataDir, st)
	}))
	http.HandleFunc("/api/driver-thumb/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleDriverThumbnail(w, r, dataDir)
	}))
	http.HandleFunc("/api/team-logo/", apiWrap(func(w http.ResponseWriter, r *http.Request) {
		handleTeamLogo(w, r, dataDir)
	}))

	if cfg.EnableAdmin {
		adminHandler := apiWrap(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			type result struct {
				Series string `json:"series"`
				Error  string `json:"error,omitempty"`
			}
			var results []result
			for _, c := range config.Championships {
				if c.Type != config.StockCarRacing {
					continue
				}
				err := importStockCarSeries(r.Context(), st, dataDir, c.ID)
				res := result{Series: c.ID}
				if err != nil {
					res.Error = err.Error()
					slog.Warn("admin reimport failed", "series", c.ID, "err", err)
				}
				results = append(results, res)
			}
			b, _ := json.Marshal(map[string]interface{}{"ok": true, "series": results})
			_, _ = w.Write(b)
		})
		http.HandleFunc("/api/admin/reimport-stockcar", wrapWithAdminToken(cfg.AdminToken, adminHandler))
		http.HandleFunc("/api/admin/data-health", wrapWithAdminToken(cfg.AdminToken, apiWrap(func(w http.ResponseWriter, r *http.Request) {
			handleDataHealth(w, r, dataDir, st)
		})))
		http.HandleFunc("/api/admin/data-diff", wrapWithAdminToken(cfg.AdminToken, apiWrap(func(w http.ResponseWriter, r *http.Request) {
			handleDataDiff(w, r, dataDir, st)
		})))
	}

	addr := ":" + cfg.Port
	srv := &http.Server{
		Addr:              addr,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		slog.Info("listening", "addr", addr)
		fmt.Println("http://localhost:" + cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "err", err)
			os.Exit(1)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	slog.Info("shutting down")
	cancelApp() // останавливаем кэш и прочие фоновые горутины
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown", "err", err)
	}
}
