package config

// F1 defines Formula 1 championship configuration.
var F1 = Championship{
	ID: "F1", Name: "Formula 1", Season: CurrentSeason,
	Type: OpenWheel, Country: "World", Active: true,
}
