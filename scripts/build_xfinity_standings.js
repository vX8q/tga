const fs = require('fs');

const raceOrder = [
  'DAY', 'ATL', 'COA', 'PHO', 'LVS', 'DAR', 'MAR', 'CAR', 'BRI', 'KAN', 'TAL', 'TEX', 'GLN', 'DOV', 'CLT', 'NSH', 'POC', 'COR', 'SON', 'CHI',
  'ATL2', 'IND', 'IOW', 'DAY2', 'DAR2', 'GTW', 'BRI2', 'LVS2', 'CLT2', 'PHO2', 'TAL2', 'MAR2', 'HOM'
];

const dotRaces = {};
raceOrder.forEach(function (k) { dotRaces[k] = '.'; });

function row(pos, driver, team, manufacturer, dayResult, points, stages) {
  const races = Object.assign({}, dotRaces, { DAY: dayResult });
  return { pos, driver, team, manufacturer, points: String(points), stages: String(stages), races };
}

function ineligibleRow(driver, team, manufacturer, dayResult) {
  const races = Object.assign({}, dotRaces, { DAY: dayResult });
  return { pos: 0, driver, team, manufacturer, points: '', stages: 'Ineligible', races };
}

const eligible = [
  [1, 'Austin Hill', 'Richard Childress Racing', 'Chevrolet', '1', '75', '20'],
  [2, 'Justin Allgaier', 'JR Motorsports', 'Chevrolet', '2', '50', '15'],
  [3, 'Carson Kvapil', 'JR Motorsports', 'Chevrolet', '7', '47', '17'],
  [4, 'Jesse Love', 'Richard Childress Racing', 'Chevrolet', '9', '37', '9'],
  [5, 'Sammy Smith', 'JR Motorsports', 'Chevrolet', '5', '36', '4'],
  [6, 'Blaine Perkins', 'Jordan Anderson Racing', 'Chevrolet', '8', '36', '7'],
  [7, 'Ryan Sieg', 'RSS Racing', 'Chevrolet', '3', '34', '–'],
  [8, 'Rajah Caruth', 'JR Motorsports', 'Chevrolet', '10', '34', '6'],
  [9, 'Jordan Anderson', 'Jordan Anderson Racing', 'Chevrolet', '4', '33', '–'],
  [10, 'Ryan Ellis', "Young's Motorsports", 'Chevrolet', '6', '31', '–'],
  [11, 'Parker Retzlaff', 'Viking Motorsports', 'Chevrolet', '14', '28', '5'],
  [12, 'Anthony Alfredo', 'Viking Motorsports', 'Chevrolet', '11', '26', '–'],
  [13, 'Brennan Poole', 'Alpha Prime Racing', 'Chevrolet', '12', '25', '–'],
  [14, 'Kyle Sieg', 'RSS Racing', 'Chevrolet', '15', '22', '–'],
  [15, 'William Sawalich', 'Joe Gibbs Racing', 'Toyota', '26', '22', '11'],
  [16, 'Lavar Scott (R)', 'Alpha Prime Racing', 'Chevrolet', '16', '21', '–'],
  [17, 'Josh Bilicki', 'SS-Green Light Racing', 'Chevrolet', '17', '20', '–'],
  [18, 'Patrick Staropoli (R)', 'Big Machine Racing', 'Chevrolet', '18', '19', '–'],
  [19, 'Carson Ware', 'Barrett–Cope Racing', 'Chevrolet', '19', '18', '–'],
  [20, 'Sheldon Creed', 'Haas Factory Team', 'Chevrolet', '24', '18', '5'],
  [21, 'Austin Green', 'Peterson Racing', 'Chevrolet', '22', '15', '–'],
  [22, 'Luke Fenhaus (R)', 'Hettinger Racing', 'Ford', '23', '14', '–'],
  [23, 'Jeb Burton', 'Jordan Anderson Racing', 'Chevrolet', '25', '14', '2'],
  [24, 'Corey Day', 'Hendrick Motorsports', 'Chevrolet', '27', '10', '–'],
  [25, 'Jeremy Clements', 'Jeremy Clements Racing', 'Chevrolet', '32', '10', '5'],
  [26, 'Taylor Gray', 'Joe Gibbs Racing', 'Toyota', '28', '9', '–'],
  [27, 'Harrison Burton', 'Sam Hunt Racing', 'Toyota', '29', '8', '–'],
  [28, 'Brandon Jones', 'Joe Gibbs Racing', 'Toyota', '30', '8', '1'],
  [29, 'Sam Mayer', 'Haas Factory Team', 'Chevrolet', '31', '6', '–'],
  [30, 'Natalie Decker', 'Joey Gase Motorsports', 'Chevrolet', '33', '4', '–'],
  [31, 'Nick Sanchez', 'AM Racing', 'Ford', '36', '4', '3'],
  [32, 'Josh Williams', 'DGM Racing', 'Chevrolet', '34', '3', '–'],
  [33, 'Dean Thompson', 'Sam Hunt Racing', 'Toyota', '35', '2', '–'],
  [34, 'Mason Maggio', 'DGM Racing', 'Chevrolet', '38', '1', '–']
];

const ineligible = [
  ['Patrick Emerling', 'RSS Racing', 'Chevrolet', '13'],
  ['Carson Hocevar', "Young's Motorsports", 'Chevrolet', '20'],
  ['Daniel Dye', 'AM Racing', 'Ford', '21'],
  ['Gio Ruggiero', 'Joe Gibbs Racing', 'Toyota', '37'],
  ['Ross Chastain', 'JR Motorsports', 'Chevrolet', '–'],
  ['Cody Ware', 'Barrett–Cope Racing', 'Chevrolet', '–'],
  ['Nick Leitz', "Young's Motorsports", 'Chevrolet', '–']
];

const rows = eligible.map(function (r) {
  return row(r[0], r[1], r[2], r[3], r[4], r[5], r[6]);
}).concat(ineligible.map(function (r) {
  return ineligibleRow(r[0], r[1], r[2], r[3]);
}));

const out = { race_order: raceOrder, rows };
fs.writeFileSync('data/standings/NOAPS.json', JSON.stringify(out, null, 2));
console.log('Wrote data/standings/NOAPS.json');
