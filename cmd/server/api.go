package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// writeError отправляет JSON-ответ с полем "error" и заданным HTTP-статусом.
// Используется во всех API-хендлерах для единообразной обработки ошибок.
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	body := map[string]string{"error": message}
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Warn("writeError: failed to encode body", "err", err)
	}
}
