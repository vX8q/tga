# ── Stage 1: сборка Go-бинарника ─────────────────────────────────────────────
# Используем актуальный образ для уменьшения числа уязвимостей (CVE)
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Зависимости (кешируются отдельно)
COPY go.mod go.sum ./
RUN go mod download

# Исходники
COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o server ./cmd/server/

# ── Stage 2: минимальный образ ────────────────────────────────────────────────
FROM alpine:3.21

# ca-certificates нужны для HTTPS-запросов внутри Go; tzdata — для корректных таймзон
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/server   ./server
COPY --from=builder /app/web      ./web

# Данные монтируются снаружи через volume
VOLUME ["/app/data"]

ENV TGA_DATA=/app/data
EXPOSE 8080

ENTRYPOINT ["./server"]
