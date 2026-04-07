.PHONY: build test lint run dev ci docker

build:
	go build -trimpath -o server.exe ./cmd/server/
	go build -trimpath -o fetch-wikidata.exe ./cmd/fetch-driver-wikidata/

test:
	go test ./... -count=1 -race 2>/dev/null || go test ./...

lint:
	golangci-lint run ./... 2>/dev/null || go vet ./...

run: build
	./server.exe

# Локальная разработка: сервер + live-данные в одном процессе (go run).
dev:
	go run ./cmd/server

# Локальная проверка перед коммитом: тесты + линтер.
ci: test lint

docker:
	docker build -t tga:latest .
	docker run --rm -p 8080:8080 -v "$(PWD)/data:/app/data" tga:latest
