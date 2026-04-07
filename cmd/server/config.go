package main

import (
	"fmt"
	"os"
	"strconv"
)

// Config — параметры сервера из env и дефолтов.
type Config struct {
	DataDir       string
	WebDir        string
	Port          string
	ResetDB       bool
	EnableAdmin   bool
	AdminToken    string  // секрет для доступа к /api/admin/* (X-Admin-Token или Authorization: Bearer <token>)
	RateLimitRPS  float64 // запросов в секунду на IP (0 = без лимита)
	EnablePprof   bool    // включить /debug/pprof* (только для dev/стейджа)
}

// LoadConfig читает конфиг из переменных окружения (дефолты: port 8080, reset_db и admin выключены).
func LoadConfig() Config {
	cfg := Config{
		DataDir:      "",
		WebDir:       "web",
		Port:         "8080",
		ResetDB:      false,
		EnableAdmin:  false,
		EnablePprof:  false,
	}
	if v := os.Getenv("TGA_DATA"); v != "" {
		cfg.DataDir = v
	}
	if v := os.Getenv("TGA_WEB"); v != "" {
		cfg.WebDir = v
	}
	if v := os.Getenv("PORT"); v != "" {
		if _, err := strconv.Atoi(v); err == nil {
			cfg.Port = v
		}
	}
	cfg.ResetDB = os.Getenv("TGA_RESET_DB_ON_START") == "1"
	cfg.EnableAdmin = os.Getenv("TGA_ENABLE_ADMIN") == "1"
	cfg.EnablePprof = os.Getenv("TGA_ENABLE_PPROF") == "1"
	if v := os.Getenv("TGA_ADMIN_TOKEN"); v != "" {
		cfg.AdminToken = v
	}
	if v := os.Getenv("TGA_RATE_LIMIT_RPS"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			cfg.RateLimitRPS = f
		}
	}
	return cfg
}

// Validate проверяет согласованность конфига
// и возвращает ошибку при некорректных значениях.
func (c Config) Validate() error {
	if _, err := strconv.Atoi(c.Port); err != nil {
		return fmt.Errorf("invalid port %q: %w", c.Port, err)
	}
	if c.EnableAdmin && c.AdminToken == "" {
		return fmt.Errorf("TGA_ENABLE_ADMIN=1 but TGA_ADMIN_TOKEN is empty")
	}
	return nil
}
