package appenv

import (
	"os"
	"path/filepath"
)

// ResolveDataDir возвращает каталог данных: override (если не пустой и существует),
// иначе TGA_DATA, иначе data/../data, обход CWD, затем относительно исполняемого файла.
func ResolveDataDir(override string) string {
	if override != "" {
		if _, err := os.Stat(override); err == nil {
			return override
		}
	}
	if d := os.Getenv("TGA_DATA"); d != "" {
		if _, err := os.Stat(d); err == nil {
			return d
		}
	}
	for _, dataDir := range []string{"data", filepath.Join("..", "data")} {
		if _, err := os.Stat(dataDir); err == nil {
			return dataDir
		}
	}
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 10; i++ {
			dataDir := filepath.Join(dir, "data")
			if _, err := os.Stat(filepath.Join(dataDir, "schedules")); err == nil {
				return dataDir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for _, d := range []string{filepath.Join(dir, "data"), filepath.Join(dir, "..", "data")} {
			if _, err := os.Stat(d); err == nil {
				return d
			}
		}
	}
	return "data"
}
