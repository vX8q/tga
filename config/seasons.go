package config

// Season — сезон чемпионата
type Season struct {
	ChampionshipID string
	SeasonYear     string // "2026"
	Active         bool
}

// Seasons — сезоны по чемпионатам (для импорта и отображения)
func Seasons() []Season {
	out := make([]Season, 0, len(Championships))
	for _, c := range Championships {
		if c.Active {
			out = append(out, Season{
				ChampionshipID: c.ID,
				SeasonYear:     c.Season,
				Active:         true,
			})
		}
	}
	return out
}
