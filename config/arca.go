// Package config defines championship settings.
package config

// ARCA — организация под управлением NASCAR
var ARCA = Championship{
	ID: "ARCA", Name: "ARCA Menards Series", Season: CurrentSeason,
	Type: StockCarRacing, Country: "USA", Active: true,
}
