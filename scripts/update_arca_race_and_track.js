const fs = require('fs');
const path = require('path');

const eventPath = path.join(__dirname, '..', 'data', 'events', 'ARCA_2026_1.json');
const data = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

const raceResultsRows = [
  ["1", "9", "18", "Gio Ruggiero", "Joe Gibbs Racing", "Toyota", "84", "6", "Running", "47"],
  ["2", "39", "20", "Jake Bollman (R)", "Nitro Motorsports", "Toyota", "84", "0", "Running", "42"],
  ["3", "32", "76", "Kole Raz", "Rette Jones Racing", "Ford", "84", "0", "Running", "41"],
  ["4", "3", "24", "Daniel Dye", "SPS Racing", "Ford", "84", "20", "Running", "41"],
  ["5", "17", "07", "Glen Reen", "KLAS Motorsports", "Ford", "84", "0", "Running", "39"],
  ["6", "12", "28", "Jack Wood", "Pinnacle Racing Group", "Chevrolet", "84", "0", "Running", "38"],
  ["7", "40", "97", "Jason Kitzmiller", "CR7 Motorsports", "Chevrolet", "84", "0", "Running", "37"],
  ["8", "11", "91", "Ryan Vargas", "Maples Motorsports", "Ford", "84", "1", "Running", "37"],
  ["9", "7", "89", "Bobby Dale Earnhardt", "Rise Racing", "Chevrolet", "84", "0", "Running", "35"],
  ["10", "25", "71", "Andy Jankowiak", "KLAS Motorsports", "Chevrolet", "84", "0", "Running", "34"],
  ["11", "5", "30", "Garrett Mitchell", "Rette Jones Racing", "Ford", "84", "0", "Running", "33"],
  ["12", "34", "99", "Michael Maples", "Maples Motorsports", "Chevrolet", "84", "0", "Running", "32"],
  ["13", "14", "34", "Bryce Applegate", "Mullins Racing", "Chevrolet", "84", "0", "Running", "31"],
  ["14", "13", "88", "A. J. Moyer", "Moyer–Petroniro Racing", "Chevrolet", "84", "0", "Running", "30"],
  ["15", "10", "41", "Robbie Kennealy", "Jan's Towing Racing", "Ford", "84", "0", "Running", "29"],
  ["16", "35", "12", "Takuma Koga", "Fast Track Racing", "Toyota", "84", "0", "Running", "28"],
  ["17", "16", "3", "Willie Mullins", "Mullins Racing", "Ford", "84", "0", "Running", "27"],
  ["18", "26", "11", "Bryce Haugeberg", "Fast Track Racing", "Toyota", "84", "0", "Running", "26"],
  ["19", "28", "57", "Hunter Deshautelle", "Brother-In-Law Racing", "Chevrolet", "84", "0", "Running", "25"],
  ["20", "18", "15", "Jake Finch", "Nitro Motorsports", "Toyota", "84", "32", "Running", "26"],
  ["21", "33", "10", "Ed Pompa", "Fast Track Racing", "Chevrolet", "84", "0", "Running", "23"],
  ["22", "19", "7", "Eric Caudell", "CCM Racing", "Toyota", "84", "0", "Running", "22"],
  ["23", "15", "27", "Tim Richmond", "Tim Richmond Racing", "Toyota", "84", "0", "Running", "21"],
  ["24", "27", "32", "Charles Weslowski Jr.", "Weslowski Racing", "Chevrolet", "83", "0", "Running", "20"],
  ["25", "38", "48", "Brad Smith", "Brad Smith Motorsports", "Ford", "82", "0", "Running", "19"],
  ["26", "31", "70", "Thomas Annunziata", "Nitro Motorsports", "Toyota", "82", "0", "Running", "18"],
  ["27", "21", "9", "Presley Sorah", "Fast Track Racing", "Ford", "82", "0", "Running", "17"],
  ["28", "23", "75", "Bryan Dauzat", "Brother-In-Law Racing", "Chevrolet", "80", "0", "Running", "16"],
  ["29", "1", "25", "Gus Dean", "Nitro Motorsports", "Toyota", "79", "15", "Accident", "17"],
  ["30", "24", "77", "Taylor Reimer", "Pinnacle Racing Group", "Chevrolet", "79", "0", "Running", "14"],
  ["31", "35", "06", "Con Nicolopoulos", "Wayne Peterson Motorsports", "Chevrolet", "78", "0", "Running", "13"],
  ["32", "29", "93", "Caleb Costner", "Costner Motorsports", "Chevrolet", "72", "0", "Running", "12"],
  ["33", "4", "8", "Sean Corr", "Empire Racing", "Chevrolet", "68", "0", "Accident", "11"],
  ["34", "30", "68", "Alli Owens", "Kimmel Racing", "Ford", "67", "0", "Accident", "10"],
  ["35", "22", "90", "Wesley Slimp", "Nitro Motorsports", "Toyota", "46", "0", "Mechanical", "9"],
  ["36", "37", "03", "Alex Clubb", "Clubb Racing Inc.", "Ford", "44", "0", "Radiator", "8"],
  ["37", "2", "55", "Isabella Robusto", "Nitro Motorsports", "Toyota", "42", "10", "Clutch", "8"],
  ["38", "8", "17", "Mini Tyrrell", "Cook Racing Technologies", "Chevrolet", "37", "0", "Mechanical", "6"],
  ["39", "6", "66", "Derek White", "MBM Motorsports", "Ford", "34", "0", "Vibration", "5"],
  ["40", "20", "36", "Ryan Huff", "Ryan Huff Motorsports", "Ford", "0", "0", "Engine", "4"],
];

const cautionBreakdownRows = [
  ["", "1", "5", "5", "", ""],
  ["", "6", "8", "3", "#17 spun backstretch", "none"],
  ["", "9", "17", "9", "", ""],
  ["", "18", "22", "5", "#90 spun backstretch", "#48"],
  ["", "23", "38", "16", "", ""],
  ["", "39", "45", "7", "#93 stopped backstretch", "#03"],
  ["", "46", "52", "7", "", ""],
  ["", "53", "55", "3", "#9 spun turn 2", "#88"],
  ["", "56", "67", "12", "", ""],
  ["", "68", "71", "4", "#8,34,68 accident turn 2", "#30"],
  ["", "72", "72", "1", "", ""],
  ["", "73", "77", "5", "#70,97 accident backstretch", "#88"],
  ["", "78", "78", "1", "", ""],
  ["", "79", "83", "5", "#15,25 accident backstretch", "#32"],
  ["", "84", "84", "1", "", ""],
];

const trackInfoText = "Daytona's tri-oval is 2.500 mi (4.023 km) long with 31° banking in the turns and 18° banking at the start/finish line. The front straight is 3,800 ft (1,200 m) long and the back straight (or \"superstretch\") is 3,000 ft (910 m) long. The tri-oval shape was revolutionary at the time as it greatly improved sight lines for fans. It is one of the three tracks on the NASCAR Cup Series circuit that are considered \"drafting tracks\", the others being Talladega Superspeedway and Atlanta Motor Speedway.";

data.tables.race_results = {
  headers: ["Fin", "St", "#", "Driver", "Team", "Make", "Laps", "Led", "Status", "Pts"],
  rows: raceResultsRows,
};

data.tables.race_statistics = {
  headers: ["Statistic", "Value"],
  rows: [
    ["Lead changes", "7 among 6 different drivers"],
    ["Cautions / Laps", "7 for 32 laps"],
    ["Red flags", "1"],
    ["Time of race", "2 hours, 1 minute and 40 seconds"],
    ["Average speed", "121.429 miles per hour (195.421 km/h)"],
  ],
};

data.tables.caution_breakdown = {
  headers: ["Condition", "From Lap", "To Lap", "# Of Laps", "Reason", "Free Pass"],
  rows: cautionBreakdownRows,
};

data.tables.track_info = {
  headers: ["Field", "Value"],
  rows: [["Track", trackInfoText]],
};

// Keep table order: insert caution_breakdown before track_info
const order = ['practice', 'qualifying', 'did_not_qualify', 'race_results', 'race_statistics', 'caution_breakdown', 'track_info'];
const newTables = {};
order.forEach(function (k) {
  if (data.tables[k]) newTables[k] = data.tables[k];
});
data.tables = newTables;

fs.writeFileSync(eventPath, JSON.stringify(data, null, 2), 'utf8');
console.log('ARCA_2026_1.json updated: race_results (Led/Status/Pts), race_statistics, caution_breakdown, track_info.');
