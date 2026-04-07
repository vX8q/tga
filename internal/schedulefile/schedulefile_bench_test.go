package schedulefile

import (
	"path/filepath"
	"testing"
)

// BenchmarkBuildDriverStatsFromEvents использует реальные JSON‑файлы из ./data
// и помогает отследить регрессии производительности при изменении логики.
func BenchmarkBuildDriverStatsFromEvents(b *testing.B) {
	dataDir := filepath.Join("..", "..", "data")
	series := []string{
		"NASCAR_CUP",
		"NASCAR_XFINITY",
		"INDYCAR",
		"SUPERCARS",
	}
	season := "2024"

	for _, s := range series {
		seriesID := s
		b.Run(seriesID, func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				_, err := BuildDriverStatsFromEvents(dataDir, seriesID, season)
				if err != nil {
					b.Fatalf("BuildDriverStatsFromEvents(%s): %v", seriesID, err)
				}
			}
		})
	}
}

