package models

import "time"

// Driver — пилот
type Driver struct {
	ID          string
	Name        string
	ShortName   string
	Nationality string
	Number      string    // постоянный номер в серии (если есть)
	BirthDate   time.Time
	BirthPlace  string    // место рождения в формате "Город, Регион/штат, Страна" (например Corning, California, U.S.)
	Slug        string    // URL-friendly slug computed from Name
}
