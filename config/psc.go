package config

// PSC defines Porsche Supercup championship configuration.
var PSC = Championship{
	ID: "PSC", Name: "Porsche Supercup", Season: CurrentSeason,
	Type: SingleMake, Country: "World", Active: true,
}
