package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

const (
	rateLimitCleanInterval = 2 * time.Minute
	rateLimitMaxAge        = 15 * time.Minute
)

type clientEntry struct {
	lim     *rate.Limiter
	lastSeen time.Time
}

// rateLimiter обёртка над rate.Limiter для использования в middleware.
// Периодически удаляет записи по клиентам, не появлявшимся дольше rateLimitMaxAge (нет утечки памяти).
type rateLimiter struct {
	mu        sync.Mutex
	limit     rate.Limit
	burst     int
	clients   map[string]*clientEntry
	lastClean time.Time
}

func newRateLimiter(rps float64, burst int) *rateLimiter {
	if rps <= 0 {
		return nil
	}
	return &rateLimiter{
		limit:     rate.Limit(rps),
		burst:     burst,
		clients:   make(map[string]*clientEntry),
		lastClean: time.Now(),
	}
}

func (rl *rateLimiter) allow(r *http.Request) bool {
	if rl == nil {
		return true
	}
	key := r.RemoteAddr
	if ip, _, err := net.SplitHostPort(key); err == nil {
		key = ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		key = strings.TrimSpace(strings.SplitN(fwd, ",", 2)[0])
	} else if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		key = strings.TrimSpace(realIP)
	}
	if key == "" {
		key = "unknown"
	}
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if now.Sub(rl.lastClean) > rateLimitCleanInterval {
		for k, e := range rl.clients {
			if now.Sub(e.lastSeen) > rateLimitMaxAge {
				delete(rl.clients, k)
			}
		}
		rl.lastClean = now
	}
	e, ok := rl.clients[key]
	if !ok {
		e = &clientEntry{lim: rate.NewLimiter(rl.limit, rl.burst)}
		rl.clients[key] = e
	}
	e.lastSeen = now
	return e.lim.Allow()
}
