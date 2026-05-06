package config

// NASCARTruck defines NASCAR Truck Series championship configuration.
var NASCARTruck = Championship{
	ID: "NASCAR_TRUCK", Name: "NASCAR Craftsman Truck Series", Season: CurrentSeason,
	Type: StockCarRacing, Country: "USA", Active: true,
}
