package config

// IndyCar defines IndyCar championship configuration.
var IndyCar = Championship{
	ID: "INDYCAR", Name: "IndyCar Series", Season: CurrentSeason,
	Type: OpenWheel, Country: "USA", Active: true,
}
