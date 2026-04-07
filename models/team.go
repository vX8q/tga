package models

// Team — команда/конструктор (для F1), или команда в кузовных сериях
type Team struct {
	ID       string
	Name     string
	Country  string
	Car      string  // конструктор/модель (e.g. "Red Bull", "Penske")
}
