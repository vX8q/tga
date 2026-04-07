package main

import (
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	requestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency in seconds",
			Buckets: prometheus.ExponentialBuckets(0.001, 2, 12),
		},
		[]string{"method", "route", "status"},
	)
)

// normalizeRoute replaces dynamic segments with placeholders to avoid
// unbounded cardinality in Prometheus labels.
func normalizeRoute(path string) string {
	switch {
	case strings.HasPrefix(path, "/api/events/"):
		return "/api/events/:id"
	case strings.HasPrefix(path, "/api/driver/"):
		return "/api/driver/:slug"
	case strings.HasPrefix(path, "/api/series/"):
		return "/api/series/:id"
	case strings.HasPrefix(path, "/event/"):
		return "/event/:id"
	case strings.HasPrefix(path, "/web/"):
		return "/web/*"
	default:
		return path
	}
}

func observeRequest(method, path string, status int, d time.Duration) {
	requestDuration.WithLabelValues(method, normalizeRoute(path), strconv.Itoa(status)).Observe(d.Seconds())
}
