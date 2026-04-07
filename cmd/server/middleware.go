package main

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/google/uuid"
)

type contextKey string

const traceIDKey contextKey = "trace_id"

// TraceID возвращает trace_id из контекста (если задан middleware).
func TraceID(ctx context.Context) string {
	if s, ok := ctx.Value(traceIDKey).(string); ok {
		return s
	}
	return ""
}

// wrapWithTraceID добавляет trace_id в контекст и в заголовок ответа X-Trace-ID.
func wrapWithTraceID(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = uuid.New().String()
		}
		w.Header().Set("X-Trace-ID", traceID)
		ctx := context.WithValue(r.Context(), traceIDKey, traceID)
		h(w, r.WithContext(ctx))
	}
}

// responseWriter запоминает статус и размер ответа для логов и метрик.
type responseWriter struct {
	http.ResponseWriter
	status int
	written int64
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(p []byte) (n int, err error) {
	n, err = rw.ResponseWriter.Write(p)
	rw.written += int64(n)
	return n, err
}

// wrapWithLogging логирует метод, путь, статус, размер и trace_id; записывает длительность в Prometheus.
func wrapWithLogging(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		h(rw, r)
		d := time.Since(start)
		traceID := TraceID(r.Context())
		observeRequest(r.Method, r.URL.Path, rw.status, d)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"bytes", rw.written,
			"duration_ms", d.Milliseconds(),
			"trace_id", traceID,
		)
	}
}

// wrapWithRecovery ловит панику и отдаёт 500 вместо падения процесса.
func wrapWithRecovery(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered", "panic", rec, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		h(w, r)
	}
}

// wrapWithCORS добавляет CORS-заголовки и обрабатывает preflight (OPTIONS).
func wrapWithCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Trace-ID")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}

// wrapWithRateLimit возвращает middleware, ограничивающее число запросов по IP.
func wrapWithRateLimit(limiter *rateLimiter) func(http.HandlerFunc) http.HandlerFunc {
	return func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if limiter != nil && !limiter.allow(r) {
				writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			h(w, r)
		}
	}
}

// wrapWithAdminToken требует заголовок X-Admin-Token или Authorization: Bearer <token> для доступа.
// OPTIONS (preflight) пропускается без проверки токена, чтобы CORS работал из браузера.
func wrapWithAdminToken(token string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			h(w, r)
			return
		}
		if token == "" {
			writeError(w, http.StatusForbidden, "admin not configured")
			return
		}
		got := r.Header.Get("X-Admin-Token")
		if got == "" {
			if auth := r.Header.Get("Authorization"); len(auth) > 7 && auth[:7] == "Bearer " {
				got = auth[7:]
			}
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			writeError(w, http.StatusUnauthorized, "invalid admin token")
			return
		}
		h(w, r)
	}
}

// chain оборачивает handler в middleware по порядку (сначала CORS, recovery, trace, rate, logging).
func chain(h http.HandlerFunc, middlewares ...func(http.HandlerFunc) http.HandlerFunc) http.HandlerFunc {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
