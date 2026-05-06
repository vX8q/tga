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
	businessRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "tga_api_business_request_duration_seconds",
			Help:    "Latency of product-facing API endpoints in seconds.",
			Buckets: prometheus.ExponentialBuckets(0.005, 2, 10),
		},
		[]string{"endpoint"},
	)
	apiSeriesViewsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "tga_api_series_views_total",
			Help: "Total reads of series-related API endpoints.",
		},
	)
	apiEventViewsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "tga_api_event_views_total",
			Help: "Total reads of event details endpoint.",
		},
	)
	apiDriverViewsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "tga_api_driver_views_total",
			Help: "Total reads of driver profile endpoint.",
		},
	)
	apiLiveEventsReadsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "tga_api_live_events_reads_total",
			Help: "Total reads of live events endpoint.",
		},
	)
	apiAdminReadsTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "tga_api_admin_reads_total",
			Help: "Total reads of admin data endpoints.",
		},
	)
	apiErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "tga_api_errors_total",
			Help: "Total API responses with error status classes.",
		},
		[]string{"endpoint", "status_class"},
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
	route := normalizeRoute(path)
	requestDuration.WithLabelValues(method, route, strconv.Itoa(status)).Observe(d.Seconds())
	observeBusinessRequest(method, route, status, d)
}

func observeBusinessRequest(method, route string, status int, d time.Duration) {
	if method != "GET" {
		return
	}
	switch route {
	case "/api/series", "/api/series/:id":
		apiSeriesViewsTotal.Inc()
		businessRequestDuration.WithLabelValues(route).Observe(d.Seconds())
	case "/api/events/:id":
		apiEventViewsTotal.Inc()
		businessRequestDuration.WithLabelValues(route).Observe(d.Seconds())
	case "/api/driver/:slug":
		apiDriverViewsTotal.Inc()
		businessRequestDuration.WithLabelValues(route).Observe(d.Seconds())
	case "/api/live-events":
		apiLiveEventsReadsTotal.Inc()
		businessRequestDuration.WithLabelValues(route).Observe(d.Seconds())
	case "/api/admin/data-health", "/api/admin/data-diff":
		apiAdminReadsTotal.Inc()
		businessRequestDuration.WithLabelValues(route).Observe(d.Seconds())
	}
	if status >= 400 {
		apiErrorsTotal.WithLabelValues(route, statusClass(status)).Inc()
	}
}

func statusClass(status int) string {
	switch {
	case status >= 500:
		return "5xx"
	case status >= 400:
		return "4xx"
	default:
		return "ok"
	}
}
