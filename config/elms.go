package config

// ELMS defines European Le Mans Series championship configuration.
var ELMS = Championship{
	ID: "ELMS", Name: "European Le Mans Series", Season: CurrentSeason,
	Type: GTEndurance, Country: "Europe", Active: true,
}
