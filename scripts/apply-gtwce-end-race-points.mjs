/**
 * Applies Cup pts / Overall pts to GTWCE Endurance race sessions (one Main Race per event).
 * Same sporting logic as Sprint: class points from class rank, absolute points column,
 * +1 championship pole per class; Pro pole also adds +1 to Overall pts; NC/Ret keeps pole-only.
 *
 * Run: node scripts/apply-gtwce-end-race-points.mjs
 *
 * Pole starters (per event) — set from official results / grid when adding a new round:
 *   PRO, GOLD, SILVER, BRONZE = car numbers as strings.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const eventPath = path.join(
  repoRoot,
  'data/events/GT World Challenge Europe Endurance/2026/gtwce_end_2026_1.json'
);

/** Overall / class race points (Endurance Cup), positions 1–10 */
const PTS = [null, 33, 24, 19, 15, 12, 9, 6, 4, 2, 1];
const pt = (rank) => (rank >= 1 && rank <= 10 ? PTS[rank] : 0);

function fmt(n) {
  if (n === 0) return '0';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Paul Ricard 2026 — Pro #48 2P; Gold #58 3PF; Silver #21 20PF; Bronze #91 35P */
const POLE = { pro: '48', gold: '58', silver: '21', bronze: '91' };

const CLASS_KEYS = ['Pro Cup', 'Gold Cup', 'Silver Cup', 'Bronze Cup'];

function poleForClass(cls) {
  switch (cls) {
    case 'Pro Cup':
      return POLE.pro;
    case 'Gold Cup':
      return POLE.gold;
    case 'Silver Cup':
      return POLE.silver;
    case 'Bronze Cup':
      return POLE.bronze;
    default:
      return '';
  }
}

function computeSession(rows) {
  const classified = rows.filter((r) => /^\d+$/.test(String(r.pos)));
  const byClass = {
    'Pro Cup': [],
    'Gold Cup': [],
    'Silver Cup': [],
    'Bronze Cup': [],
  };
  for (const r of classified) {
    if (byClass[r.cls]) byClass[r.cls].push(r);
  }
  for (const c of CLASS_KEYS) {
    byClass[c].sort((a, b) => parseInt(a.pos, 10) - parseInt(b.pos, 10));
  }

  return rows.map((r) => {
    if (!/^\d+$/.test(String(r.pos))) {
      let cup = 0;
      let overall = 0;
      const p = poleForClass(r.cls);
      if (r.cls === 'Pro Cup' && p && r.num === p) overall = 1;
      else if (p && r.num === p) cup = 1;
      return { cupPts: fmt(cup), overallPts: fmt(overall) };
    }

    const absRank = parseInt(r.pos, 10);
    let overallPts = pt(absRank);
    if (r.cls === 'Pro Cup' && r.num === POLE.pro) overallPts += 1;

    const arr = byClass[r.cls] || [];
    const idx = arr.findIndex((x) => x.num === r.num);
    const classRank = idx >= 0 ? idx + 1 : 0;
    let cupPts = pt(classRank);
    const pole = poleForClass(r.cls);
    if (pole && r.num === pole) cupPts += 1;

    return { cupPts: fmt(cupPts), overallPts: fmt(overallPts) };
  });
}

const raw = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const sessions = raw.tables?.race?.sessions;
if (!Array.isArray(sessions) || sessions.length < 1) {
  console.error('Expected tables.race.sessions');
  process.exit(1);
}

const newHeaders = [
  'Pos',
  'Car #',
  'Class',
  'Drivers',
  'Team',
  'Car',
  'Time',
  'Laps',
  'Gap',
  'Cup pts',
  'Overall pts',
];

for (const sess of sessions) {
  const rows = sess.rows.map((row) => ({
    pos: row[0],
    num: String(row[1]),
    cls: row[2],
  }));
  const pts = computeSession(rows);
  sess.headers = newHeaders.slice();
  sess.rows = sess.rows.map((row, i) => {
    const base = row.slice(0, 9);
    const p = pts[i];
    return [...base, p.cupPts, p.overallPts];
  });
}

fs.writeFileSync(eventPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
console.log('Updated', eventPath);
