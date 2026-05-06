package config

// NASCARCup defines NASCAR Cup Series championship configuration.
var NASCARCup = Championship{
	ID: "NASCAR_CUP", Name: "NASCAR Cup Series", Season: CurrentSeason,
	Type: StockCarRacing, Country: "USA", Active: true,
}
