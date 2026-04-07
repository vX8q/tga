const fs = require('fs');

const raceOrder = [
  'DAY', 'ATL', 'STP', 'DAR', 'CAR', 'BRI', 'TEX', 'GLN', 'DOV', 'CLT', 'NSH', 'MCH', 'COR', 'LRP', 'NWS', 'IRP', 'RCH', 'NHA',
  'BRI2', 'KAN', 'CLT2', 'PHO', 'TAL', 'MAR', 'HOM'
];

const dotRaces = {};
raceOrder.forEach(function (k) { dotRaces[k] = '.'; });

function row(pos, driver, team, manufacturer, dayResult, points, stages) {
  const races = Object.assign({}, dotRaces, { DAY: dayResult });
  return { pos, driver, team, manufacturer, points: String(points), stages: String(stages), races };
}

function ineligibleRow(driver, team, manufacturer, status) {
  const races = Object.assign({}, dotRaces, { DAY: '' });
  return { pos: 0, driver, team, manufacturer, points: '', stages: status, races };
}

const eligible = [
  [1, 'Chandler Smith', 'Front Row Motorsports', 'Ford', '1*2', '65', '10'],
  [2, 'Christian Eckes', 'McAnally–Hilgemann Racing', 'Chevrolet', '3', '46', '12'],
  [3, 'Ty Majeski', 'ThorSport Racing', 'Ford', '4', '45', '12'],
  [4, 'Gio Ruggiero', 'Tricon Garage', 'Toyota', '2', '35', '–'],
  [5, 'Kaden Honeycutt', 'Tricon Garage', 'Toyota', '8', '34', '5'],
  [6, 'Brenden Queen (R)', 'Kaulig Racing', 'Ram', '7', '32', '2'],
  [7, 'Nick Leitz', 'Tricon Garage', 'Toyota', '11', '31', '5'],
  [8, 'Tyler Ankrum', 'McAnally–Hilgemann Racing', 'Chevrolet', '9', '28', '–'],
  [9, 'Stewart Friesen', 'Halmar Friesen Racing', 'Toyota', '10', '27', '–'],
  [10, 'Ben Rhodes', 'ThorSport Racing', 'Ford', '12', '26', '1'],
  [11, 'Andrés Pérez de Lara', 'Niece Motorsports', 'Chevrolet', '13', '24', '–'],
  [12, 'Cole Butcher (R)', 'ThorSport Racing', 'Ford', '14', '23', '–'],
  [13, 'Tanner Gray', 'Tricon Garage', 'Toyota', '23', '23', '9'],
  [14, 'Travis Pastrana', 'Niece Motorsports', 'Chevrolet', '15', '22', '–'],
  [15, 'Frankie Muniz', 'Team Reaume', 'Ford', '16', '21', '–'],
  [16, 'Daniel Dye', 'Kaulig Racing', 'Ram', '17', '20', '–'],
  [17, 'Clay Greenfield', 'GK Racing', 'Chevrolet', '18', '19', '–'],
  [18, 'Mini Tyrrell (R)', 'Kaulig Racing', 'Ram', '19', '18', '–'],
  [19, 'Josh Reaume', 'Team Reaume', 'Ford', '20', '17', '–'],
  [20, 'Spencer Boyd', 'Freedom Racing Enterprises', 'Chevrolet', '21', '16', '–'],
  [21, 'Justin Haley', 'Kaulig Racing', 'Ram', '22*', '15', '–'],
  [22, 'Layne Riggs', 'Front Row Motorsports', 'Ford', '31', '15', '9'],
  [23, 'Kris Wright', 'McAnally–Hilgemann Racing', 'Chevrolet', '25', '12', '–'],
  [24, 'Daniel Hemric', 'McAnally–Hilgemann Racing', 'Chevrolet', '26F', '12', '–'],
  [25, 'Dawson Sutton', 'Rackley W.A.R.', 'Chevrolet', '27', '10', '–'],
  [26, 'Grant Enfinger', 'CR7 Motorsports', 'Chevrolet', '29', '9', '1'],
  [27, 'Jason Kitzmiller', 'CR7 Motorsports', 'Chevrolet', '30', '7', '–'],
  [28, 'Jake Garcia', 'ThorSport Racing', 'Ford', '32', '5', '–'],
  [29, 'Jason White', 'Team Reaume', 'Ford', '33', '4', '–'],
  [30, 'Tony Stewart', 'Kaulig Racing', 'Ram', '36', '1', '–'],
  [31, 'Garrett Mitchell', 'Niece Motorsports', 'Chevrolet', '37', '1', '–']
];

const ineligible = [
  ['Corey Heim', 'Halmar Friesen Racing', 'Toyota', '–'],
  ['Tyler Reif', 'Niece Motorsports', 'Chevrolet', '–'],
  ['Caleb Costner', 'Costner Motorsports', 'Chevrolet', '–'],
  ['Adam Andretti', 'Tricon Garage', 'Toyota', '–'],
  ['Norm Benning', 'Norm Benning Racing', 'Chevrolet', 'DNQ'],
  ['Toni Breidinger', 'Rackley W.A.R.', 'Chevrolet', 'DNQ'],
  ['Bryan Dauzat', 'FDNY Racing', 'Chevrolet', 'DNQ'],
  ['Greg Van Alst', 'Greg Van Alst Motorsports', 'Toyota', 'DNQ'],
  ['Timmy Hill', 'Hill Motorsports', 'Toyota', 'DNQ'],
  ['Tyler Tomassi', 'MBM Motorsports', 'Ford', 'DNQ'],
  ['Justin Carroll', 'TC Motorsports', 'Chevrolet', 'DNQ']
];

const rows = eligible.map(function (r) {
  return row(r[0], r[1], r[2], r[3], r[4], r[5], r[6]);
}).concat(ineligible.map(function (r) {
  return ineligibleRow(r[0], r[1], r[2], r[3]);
}));

const out = { race_order: raceOrder, rows };
fs.writeFileSync('data/standings/NASCAR_TRUCK.json', JSON.stringify(out, null, 2));
console.log('Wrote data/standings/NASCAR_TRUCK.json');
