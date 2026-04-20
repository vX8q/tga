"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standingsPath = path.join(root, "data", "standings", "supercars.json");
const ev8Path = path.join(root, "data", "events", "Supercars", "2026", "supercars_2026_8.json");
const ev9Path = path.join(root, "data", "events", "Supercars", "2026", "supercars_2026_9.json");

function canon(c) {
  return String(c).trim() === "800" ? "8" : String(c).trim();
}

function parsePts(s) {
  const m = String(s).match(/\+?(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function posStr(row) {
  const p = row[0];
  return p === "NC" ? "NC" : String(p);
}

const base = JSON.parse(fs.readFileSync(standingsPath, "utf8"));
const ev8 = JSON.parse(fs.readFileSync(ev8Path, "utf8"));
const ev9 = JSON.parse(fs.readFileSync(ev9Path, "utf8"));

const r8 = ev8.tables.race.sessions[0].rows;
const r9 = ev9.tables.race.sessions[0].rows;

const byCar = new Map();
for (const row of r8) {
  const car = canon(row[1]);
  const cur = byCar.get(car) || {};
  cur.tpo8 = posStr(row);
  cur.pts8 = parsePts(row[7]);
  byCar.set(car, cur);
}
for (const row of r9) {
  const car = canon(row[1]);
  const cur = byCar.get(car) || {};
  cur.tpo9 = posStr(row);
  cur.pts9 = parsePts(row[7]);
  byCar.set(car, cur);
}

base.race_order = base.race_order.slice(0, 7).concat(["TPO8", "TPO9"]);
base.event_names = base.event_names
  .slice(0, 7)
  .concat(["Taupō Super 440 Race 1", "Taupō Super 440 Race 2"]);
base.completed_races = base.race_order.slice();

for (const row of base.rows) {
  row.car = canon(row.car);
  const x = byCar.get(row.car);
  if (!x) continue;
  row.races = row.races || {};
  row.races.TPO8 = x.tpo8;
  row.races.TPO9 = x.tpo9;
  const old = parseInt(row.points, 10) || 0;
  row.points = String(old + (x.pts8 || 0) + (x.pts9 || 0));
}

const byDriver = new Map();
for (const row of base.rows) {
  const d = row.driver.trim();
  const car = row.car;
  const key = d + "|" + (car === "800" ? "8" : car);
  if (!byDriver.has(key)) {
    byDriver.set(key, {
      ...row,
      car: car === "800" ? "8" : car,
      races: { ...row.races },
    });
    continue;
  }
  const prev = byDriver.get(key);
  prev.car = "8";
  for (const [c, v] of Object.entries(row.races || {})) {
    if (v && v !== "—" && v !== "-") prev.races[c] = v;
  }
  prev.points = String(
    (parseInt(prev.points, 10) || 0) + (parseInt(row.points, 10) || 0)
  );
}

const outRows = [...byDriver.values()];
outRows.sort(
  (a, b) => (parseInt(b.points, 10) || 0) - (parseInt(a.points, 10) || 0)
);
outRows.forEach((r, i) => {
  r.pos = i + 1;
});
base.rows = outRows;

fs.writeFileSync(standingsPath, JSON.stringify(base, null, 2) + "\n");
console.log("Wrote", standingsPath, "rows", base.rows.length);
