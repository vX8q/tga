const fs = require('fs');

function row(manufacturer, team, number, driver, crew_chief, fullTime) {
  return { manufacturer, team, number: String(number), driver, crew_chief: crew_chief || 'TBA', full_time: fullTime };
}

const fullTime = [
  ['Chevrolet', 'CR7 Motorsports', '9', 'Grant Enfinger', 'Derek Smith'],
  ['Chevrolet', 'Freedom Racing Enterprises', '76', 'Spencer Boyd (22 races)', 'Mike Hillman Sr.'],
  ['Chevrolet', 'Freedom Racing Enterprises', '76', 'Nathan Nicholson (3 races)', 'Mike Hillman Sr.'],
  ['Chevrolet', 'McAnally–Hilgemann Racing', '18', 'Tyler Ankrum', 'Mark Hillman'],
  ['Chevrolet', 'McAnally–Hilgemann Racing', '19', 'Daniel Hemric', 'Kevin Bellicourt'],
  ['Chevrolet', 'McAnally–Hilgemann Racing', '81', 'Kris Wright', 'Darren Fraley'],
  ['Chevrolet', 'McAnally–Hilgemann Racing', '91', 'Christian Eckes', 'Dave Elenz'],
  ['Chevrolet', 'Niece Motorsports', '44', 'Andrés Pérez de Lara', 'Wally Rogers'],
  ['Chevrolet', 'Rackley W.A.R.', '26', 'Dawson Sutton', 'Chad Kendrick'],
  ['Chevrolet', 'Spire Motorsports', '7', 'Michael McDowell (1 race)', 'Brian Pattie'],
  ['Chevrolet', 'Spire Motorsports', '7', 'Kyle Busch (8 races)', 'Brian Pattie'],
  ['Chevrolet', 'Spire Motorsports', '7', 'Connor Mosack (12 races)', 'Brian Pattie'],
  ['Chevrolet', 'Spire Motorsports', '7', 'TBA (4 races)', 'Brian Pattie'],
  ['Chevrolet', 'Spire Motorsports', '77', 'Carson Hocevar (13 races)', 'Chad Walter'],
  ['Chevrolet', 'Spire Motorsports', '77', 'James Hinchcliffe (1 race)', 'Chad Walter'],
  ['Chevrolet', 'Spire Motorsports', '77', 'TBA (11 races)', 'Chad Walter'],
  ['Ford', 'Front Row Motorsports', '34', 'Layne Riggs', 'Dylan Cappello'],
  ['Ford', 'Front Row Motorsports', '38', 'Chandler Smith', 'Jon Leonard'],
  ['Ford', 'Team Reaume', '2', 'Jason White (1 race)', 'Todd Myers'],
  ['Ford', 'Team Reaume', '2', 'Clayton Green (8 races)', 'Todd Myers'],
  ['Ford', 'Team Reaume', '2', 'Luke Baldwin (8 races)', 'Todd Myers'],
  ['Ford', 'Team Reaume', '2', 'TBA (8 races)', 'Todd Myers'],
  ['Ford', 'Team Reaume', '22', 'Josh Reaume (2 races)', 'Will Camilleri'],
  ['Ford', 'Team Reaume', '22', 'Jackson Lee (1 race)', 'Will Camilleri'],
  ['Ford', 'Team Reaume', '22', 'TBA (22 races)', 'Will Camilleri'],
  ['Ford', 'Team Reaume', '33', 'Frankie Muniz', 'Pedro Lopez'],
  ['Ford', 'ThorSport Racing', '13', 'Cole Butcher (R)', 'Rich Lushes'],
  ['Ford', 'ThorSport Racing', '88', 'Ty Majeski', 'Joe Shear Jr.'],
  ['Ford', 'ThorSport Racing', '98', 'Jake Garcia', 'Josh Hankish'],
  ['Ford', 'ThorSport Racing', '99', 'Ben Rhodes', 'Eddie Troconis'],
  ['Ram', 'Kaulig Racing', '10', 'Daniel Dye', 'Dan Stillman'],
  ['Ram', 'Kaulig Racing', '12', 'Brenden Queen (R)', 'Eddie Pardue'],
  ['Ram', 'Kaulig Racing', '14', 'Mini Tyrrell (R)', 'Bruce Cook'],
  ['Ram', 'Kaulig Racing', '16', 'Justin Haley', 'Mike Hillman Jr.'],
  ['Ram', 'Kaulig Racing', '25', 'Tony Stewart (1 race)', 'Alex Yontz'],
  ['Ram', 'Kaulig Racing', '25', 'Ty Dillon (1 race)', 'Alex Yontz'],
  ['Ram', 'Kaulig Racing', '25', 'Carson Ferguson (1 race)', 'Alex Yontz'],
  ['Ram', 'Kaulig Racing', '25', 'TBA (22 races)', 'Alex Yontz'],
  ['Toyota', 'Halmar Friesen Racing', '52', 'Stewart Friesen', 'Dustin Dunn'],
  ['Toyota', 'Halmar Friesen Racing', '62', 'John Hunter Nemechek (2 races)', 'Jimmy Villeneuve'],
  ['Toyota', 'Halmar Friesen Racing', '62', 'TBA (23 races)', 'Jimmy Villeneuve'],
  ['Toyota', 'Tricon Garage', '11', 'Kaden Honeycutt', 'David Stewart (1) / Scott Zipadelli (24)'],
  ['Toyota', 'Tricon Garage', '15', 'Tanner Gray', 'Jeff Hensley'],
  ['Toyota', 'Tricon Garage', '17', 'Gio Ruggiero', 'Jeff Stankiewicz']
];

const limited = [
  ['Chevrolet', 'Costner Motorsports', '93', 'Caleb Costner', 'TBA'],
  ['Chevrolet', 'CR7 Motorsports', '97', 'Jason Kitzmiller', 'Michael Shelton'],
  ['Chevrolet', 'FDNY Racing', '28', 'Bryan Dauzat', 'Jim Rosenblum'],
  ['Chevrolet', 'Freedom Racing Enterprises', '67', 'TBA', 'TBA'],
  ['Chevrolet', 'GK Racing', '95', 'Clay Greenfield', 'Trip Bruce'],
  ['Chevrolet', 'Henderson Motorsports', '75', 'Corey LaJoie', 'Chris Carrier'],
  ['Chevrolet', 'Niece Motorsports', '4', 'Garrett Mitchell', 'Mike Shiplett'],
  ['Chevrolet', 'Niece Motorsports', '4', 'TBA', 'Mike Shiplett'],
  ['Chevrolet', 'Niece Motorsports', '42', 'Travis Pastrana', 'Landon Polinski'],
  ['Chevrolet', 'Niece Motorsports', '42', 'Tyler Reif', 'TBA'],
  ['Chevrolet', 'Niece Motorsports', '42', 'Conner Jones', 'TBA'],
  ['Chevrolet', 'Niece Motorsports', '42', 'Parker Eatmon', 'TBA'],
  ['Chevrolet', 'Niece Motorsports', '45', 'Ricky Stenhouse Jr.', 'Phil Gould'],
  ['Chevrolet', 'Niece Motorsports', '45', 'Ross Chastain', 'Phil Gould'],
  ['Chevrolet', 'Niece Motorsports', '45', 'Landen Lewis', 'TBA'],
  ['Chevrolet', 'Norm Benning Racing', '6', 'Norm Benning', 'Rick Todd'],
  ['Chevrolet', 'Rackley W.A.R.', '27', 'Toni Breidinger', 'Willie Allen'],
  ['Ford', 'MBM Motorsports', '69', 'Tyler Tomassi', 'Jason Miller'],
  ['Toyota', 'Greg Van Alst Motorsports', '35', 'Greg Van Alst', 'Kevin Shannon'],
  ['Toyota', 'Hill Motorsports', '56', 'Timmy Hill', 'Terry Elmore'],
  ['Toyota', 'Tricon Garage', '1', 'Taylor Gray', 'Jerame Donley'],
  ['Toyota', 'Tricon Garage', '1', 'Corey Heim', 'Jerame Donley'],
  ['Toyota', 'Tricon Garage', '1', 'Dario Franchitti', 'Jerame Donley'],
  ['Toyota', 'Tricon Garage', '1', 'Jimmie Johnson', 'Jerame Donley'],
  ['Toyota', 'Tricon Garage', '5', 'Nick Leitz', 'Seth Smith'],
  ['Toyota', 'Tricon Garage', '5', 'Adam Andretti', 'Seth Smith'],
  ['Chevrolet / Toyota', 'TC Motorsports', '90', 'Justin Carroll', 'Terry Carroll'],
  ['TBA', 'Mike Harmon Racing', 'TBA', 'Nick Anglace', 'TBA']
];

const teams = fullTime.map(function (r) {
  return row(r[0], r[1], r[2], r[3], r[4], true);
}).concat(limited.map(function (r) {
  return row(r[0], r[1], r[2], r[3], r[4], false);
}));

const carModels = [
  { manufacturer: 'Chevrolet', truck_brand: 'Chevrolet Silverado', model: 'Silverado' },
  { manufacturer: 'Ford', truck_brand: 'Ford F-150', model: 'F-150' },
  { manufacturer: 'Toyota', truck_brand: 'Toyota Tundra TRD Pro', model: 'Tundra TRD Pro' },
  { manufacturer: 'Ram', truck_brand: 'Ram Trucks', model: 'Ram 1500' }
];

const technicalSpec = [
  { key: 'Series', value: 'NASCAR Craftsman Truck Series' },
  { key: 'Generation / Chassis', value: 'Steel tube frame with safety roll cage (series-specific truck chassis)' },
  { key: 'Body Type', value: 'Composite/approved truck body panels styled to production pickup' },
  { key: 'Length', value: '~206.5 in (5245 mm)' },
  { key: 'Width', value: '~80 in (2032 mm)' },
  { key: 'Height', value: '~60 in (1524 mm)' },
  { key: 'Wheelbase', value: '112 in (~2845 mm)' },
  { key: 'Minimum Weight (no driver / fuel)', value: '~3200 lb (~1451 kg)' },
  { key: 'Minimum Weight (with driver + fuel)', value: '~3400 lb (~1542 kg)' },
  { key: 'Engine', value: '5.86 L (358 cu in) Pushrod V8 (built series spec)' },
  { key: 'Induction & Aspiration', value: 'Naturally aspirated (carbureted or series-spec throttle body)' },
  { key: 'Power Output', value: '~650-700 hp unrestricted / ~450 hp restricted' },
  { key: 'Torque', value: '~700 Nm (~520 ft-lb)' },
  { key: 'Fuel Type', value: 'Sunoco Green E15 (85% unleaded blend + 15% ethanol)' },
  { key: 'Fuel Capacity', value: '~18 US gal (~68 L)' },
  { key: 'Drivetrain', value: 'Rear-wheel drive (standard NASCAR layout)' },
  { key: 'Transmission', value: '4-speed manual gearbox (series spec)' },
  { key: 'Suspension (Front)', value: 'Series-approved suspension (coil/short-long arm derivative)' },
  { key: 'Suspension (Rear)', value: 'Solid rear axle (live axle)' },
  { key: 'Brakes', value: 'Steel disc brakes (multiple-piston calipers)' },
  { key: 'Wheels', value: 'Series-approved racing wheels (steel or aluminum)' },
  { key: 'Tires', value: 'Goodyear Eagle racing tires (slicks; rain tires if applicable)' },
  { key: 'Aerodynamics', value: 'Approved front air dam / truck body aero package (series rules)' },
  { key: 'Underbody', value: 'Flat floor with NASCAR-mandated safety and control devices' },
  { key: 'Safety', value: 'Roll cage, HANS device, 6-point harness, onboard fire suppression (standard NASCAR)' },
  { key: 'Key Features', value: 'Race pickup body, carburetor or series spec injection engine, live rear axle, 4-speed manual gearbox' }
];

const out = { teams, car_models: carModels, technical_spec: technicalSpec };
fs.writeFileSync('data/teams/NASCAR_TRUCK.json', JSON.stringify(out, null, 2));
console.log('Wrote data/teams/NASCAR_TRUCK.json: ' + teams.length + ' teams');
