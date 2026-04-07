package models

// Series — серия/чемпионат в БД (соответствует config.Championship)
type Series struct {
	ID       string
	Name     string
	Season   string
	Type     string
	Country  string
}
