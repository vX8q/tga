const fs = require('fs');
const path = require('path');

const eventPath = path.join(__dirname, '..', 'data', 'events', 'ARCA_2026_1.json');
const data = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

const practiceRows = [
  ["1", "15", "Jake Finch", "Nitro Motorsports", "Toyota", "48.878", "", "184.132", "9", "7"],
  ["2", "25", "Gus Dean", "Nitro Motorsports", "Toyota", "48.879", "0.001", "184.128", "9", "7"],
  ["3", "70", "Thomas Annunziata", "Nitro Motorsports", "Toyota", "48.889", "0.011", "184.090", "9", "7"],
  ["4", "55", "Isabella Robusto", "Nitro Motorsports", "Toyota", "48.894", "0.016", "184.072", "10", "8"],
  ["5", "90", "Wesley Slimp", "Nitro Motorsports", "Toyota", "48.894", "0.016", "184.072", "9", "7"],
  ["6", "20", "Jake Bollman", "Nitro Motorsports", "Toyota", "48.903", "0.025", "184.038", "9", "7"],
  ["7", "24", "Daniel Dye", "SPS Racing", "Ford", "49.110", "0.232", "183.262", "9", "6"],
  ["8", "07", "Glen Reen", "KLAS Motorsports", "Ford", "49.121", "0.243", "183.221", "9", "6"],
  ["9", "71", "Andy Jankowiak", "KLAS Motorsports", "Chevrolet", "49.143", "0.265", "183.139", "10", "6"],
  ["10", "97", "Jason Kitzmiller", "CR7 Motorsports", "Chevrolet", "49.159", "0.281", "183.079", "15", "10"],
  ["11", "28", "Jack Wood", "Pinnacle Racing Group", "Chevrolet", "49.159", "0.281", "183.079", "8", "6"],
  ["12", "17", "Mini Tyrrell", "Cook Racing Technologies", "Chevrolet", "49.166", "0.288", "183.053", "9", "6"],
  ["13", "18", "Giovanni Ruggiero", "Joe Gibbs Racing", "Toyota", "49.166", "0.288", "183.053", "11", "6"],
  ["14", "34", "Bryce Applegate", "Mullins Racing", "Chevrolet", "49.692", "0.814", "181.116", "16", "13"],
  ["15", "40", "Andrew Patterson", "Andrew Patterson Racing", "Chevrolet", "50.132", "1.254", "179.526", "20", "19"],
  ["16", "30", "Garrett Mitchell", "Rette Jones Racing", "Ford", "50.385", "1.507", "178.625", "17", "17"],
  ["17", "27", "Tim Richmond", "Tim Richmond Racing", "Toyota", "50.405", "1.527", "178.554", "8", "7"],
  ["18", "89", "Bobby Earnhardt", "Rise Racing", "Chevrolet", "50.419", "1.541", "178.504", "20", "10"],
  ["19", "76", "Kole Raz", "Rette Jones Racing", "Ford", "50.420", "1.542", "178.501", "16", "16"],
  ["20", "7", "Eric Caudell", "CCM Racing", "Toyota", "50.426", "1.548", "178.479", "9", "9"],
  ["21", "8", "Sean Corr", "Empire Racing", "Chevrolet", "50.428", "1.550", "178.472", "12", "7"],
  ["22", "22", "Nick White", "White Motorsports", "Chevrolet", "50.456", "1.578", "178.373", "8", "7"],
  ["23", "62", "Steve Lewis, Jr.", "Steve Lewis Racing", "Chevrolet", "50.490", "1.612", "178.253", "15", "8"],
  ["24", "91", "Ryan Vargas", "Maples Motorsports", "Ford", "50.584", "1.706", "177.922", "12", "6"],
  ["25", "99", "Michael Maples", "Maples Motorsports", "Chevrolet", "50.629", "1.751", "177.764", "12", "6"],
  ["26", "66", "Derek White", "MBM Motorsports", "Ford", "50.671", "1.793", "177.616", "13", "11"],
  ["27", "77", "Taylor Reimer", "Pinnacle Racing Group", "Chevrolet", "50.711", "1.833", "177.476", "6", "5"],
  ["28", "12", "Takuma Koga", "Fast Track Racing", "Toyota", "50.719", "1.841", "177.448", "6", "4"],
  ["29", "52", "Robert Martin", "Martin Racing", "Toyota", "50.893", "2.015", "176.842", "15", "13"],
  ["30", "68", "Alli Owens", "Kimmel Racing", "Ford", "50.918", "2.040", "176.755", "14", "2"],
  ["31", "3", "Willie Mullins", "Mullins Racing", "Ford", "50.920", "2.042", "176.748", "7", "2"],
  ["32", "32", "Charles Weslowski", "Weslowski Racing", "Chevrolet", "50.947", "2.069", "176.654", "15", "9"],
  ["33", "88", "A.J. Moyer", "Moyer–Petroniro Racing", "Chevrolet", "50.958", "2.080", "176.616", "12", "6"],
  ["34", "36", "Ryan Huff", "Ryan Huff Motorsports", "Ford", "50.967", "2.089", "176.585", "10", "10"],
  ["35", "69", "Nolan Wilson", "Kimmel Racing", "Chevrolet", "50.996", "2.118", "176.484", "20", "19"],
  ["36", "86", "Logan Misuraca", "City Garage Motorsports", "Ford", "51.106", "2.228", "176.105", "7", "5"],
  ["37", "1", "Tony Cosentino", "Maples Motorsports", "Ford", "51.140", "2.262", "175.987", "13", "8"],
  ["38", "41", "Robbie Kennealy", "Jan's Towing Racing", "Ford", "51.333", "2.455", "175.326", "14", "2"],
  ["39", "57", "Hunter Deshautelle", "Brother-In-Law Racing", "Chevrolet", "51.353", "2.475", "175.258", "13", "11"],
  ["40", "9", "Presley Sorah", "Fast Track Racing", "Ford", "51.546", "2.668", "174.601", "8", "8"],
  ["41", "11", "Bryce Haugeberg", "Fast Track Racing", "Toyota", "51.690", "2.812", "174.115", "10", "8"],
  ["42", "10", "Ed Pompa", "Fast Track Racing", "Chevrolet", "51.802", "2.924", "173.738", "10", "1"],
  ["43", "75", "Bryan Dauzat", "Brother-In-Law Racing", "Chevrolet", "52.144", "3.266", "172.599", "3", "2"],
  ["44", "26", "Ron Vandermeir, Jr.", "Vanco Racing", "Toyota", "52.402", "3.524", "171.749", "6", "6"],
  ["45", "03", "Alex Clubb", "Clubb Racing Inc.", "Ford", "52.694", "3.816", "170.797", "8", "2"],
  ["46", "19", "Greg Van Alst", "Maples Motorsports", "Chevrolet", "52.737", "3.859", "170.658", "2", "2"],
  ["47", "48", "Brad Smith", "Brad Smith Motorsports", "Ford", "54.961", "6.083", "163.752", "8", "2"],
  ["48", "06", "Con Nicolopoulos", "Wayne Peterson Motorsports", "Chevrolet", "55.107", "6.229", "163.319", "2", "2"],
  ["49", "98", "Dale Shearer", "Shearer Speed Racing", "Toyota", "1:02.552", "13.674", "143.880", "2", "1"],
];

const cur = data.tables.qualifying.rows;
const qualifyingRows = cur.slice(0, 40);
const dnqRows = cur.slice(41, 51);
const raceHeaderRow = cur[53];
const raceDataRows = cur.slice(54, 94);
const statRows = cur.slice(95, 100);

const practice = {
  headers: ["Rank", "No.", "Driver", "Team", "Manufacturer", "Time", "Diff", "Speed", "# Laps", "Best Lap"],
  rows: practiceRows,
};

const qualifying = {
  headers: data.tables.qualifying.headers,
  rows: qualifyingRows,
};

const did_not_qualify = {
  headers: ["Pos.", "#", "Driver", "Team", "Make", "Time", "Speed"],
  rows: dnqRows,
};

const race_results = {
  headers: raceHeaderRow.filter(Boolean),
  rows: raceDataRows,
};

const race_statistics = {
  headers: ["Statistic", "Value"],
  rows: statRows,
};

data.tables = {
  practice,
  qualifying,
  did_not_qualify,
  race_results,
  race_statistics,
  event_preview: data.tables.event_preview,
};

fs.writeFileSync(eventPath, JSON.stringify(data, null, 2), 'utf8');
console.log('ARCA_2026_1.json updated: practice added, qualifying/did_not_qualify/race_results/race_statistics split.');
