package config

// WEC defines FIA World Endurance Championship configuration.
var WEC = Championship{
	ID: "WEC", Name: "FIA World Endurance Championship", Season: CurrentSeason,
	Type: GTEndurance, Country: "World", Active: true,
}
