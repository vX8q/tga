/**
 * Applies Cup pts / Overall pts to gtwce_sprint_2026_1.json race sessions.
 * Run: node scripts/apply-gtwce-sprint-race-points.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const eventPath = path.join(
  repoRoot,
  'data/events/GT World Challenge Europe Sprint/2026/gtwce_sprint_2026_1.json'
);

// SRO Sprint Cup: 6th = 4 (not 4.5). Pole +1 applied separately in computeSession.
const PTS = [null, 16.5, 12, 9.5, 7.5, 6, 4, 3, 2, 1, 0.5];
const pt = (rank) => (rank >= 1 && rank <= 10 ? PTS[rank] : 0);

function fmt(n) {
  if (n === 0) return '0';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const R1_POLE = { pro: '80', gold: '99', silver: '30' };
const R2_POLE = { pro: '80', gold: '10', silver: '30' };

function computeSession(rows, pole) {
  const classified = rows.filter((r) => /^\d+$/.test(String(r.pos)));
  const byClass = { 'Pro Cup': [], 'Gold Cup': [], 'Silver Cup': [] };
  for (const r of classified) {
    if (byClass[r.cls]) byClass[r.cls].push(r);
  }
  for (const c of Object.keys(byClass)) {
    byClass[c].sort((a, b) => parseInt(a.pos, 10) - parseInt(b.pos, 10));
  }
  return rows.map((r) => {
    if (!/^\d+$/.test(String(r.pos))) {
      // NC / Ret / DNS: no race points, but class pole still awards +1 (e.g. RetP in standings).
      let cup = 0;
      let overall = 0;
      if (r.cls === 'Pro Cup' && r.num === pole.pro) overall = 1;
      if (r.cls === 'Gold Cup' && r.num === pole.gold) cup = 1;
      if (r.cls === 'Silver Cup' && r.num === pole.silver) cup = 1;
      return { cupPts: fmt(cup), overallPts: fmt(overall) };
    }
    const oRank = parseInt(r.pos, 10);
    let overall = pt(oRank);
    if (r.cls === 'Pro Cup' && r.num === pole.pro) overall += 1;
    const arr = byClass[r.cls] || [];
    const idx = arr.findIndex((x) => x.num === r.num);
    const cRank = idx >= 0 ? idx + 1 : 0;
    let cup = pt(cRank);
    if (r.cls === 'Pro Cup' && r.num === pole.pro) cup += 1;
    if (r.cls === 'Gold Cup' && r.num === pole.gold) cup += 1;
    if (r.cls === 'Silver Cup' && r.num === pole.silver) cup += 1;
    return { cupPts: fmt(cup), overallPts: fmt(overall) };
  });
}

const raw = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
const sessions = raw.tables?.race?.sessions;
if (!Array.isArray(sessions) || sessions.length < 2) {
  console.error('Expected tables.race.sessions with Race 1 and Race 2');
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

for (let s = 0; s < 2; s++) {
  const sess = sessions[s];
  const rows = sess.rows.map((row) => ({
    pos: row[0],
    num: String(row[1]),
    cls: row[2],
  }));
  const pole = s === 0 ? R1_POLE : R2_POLE;
  const pts = computeSession(rows, pole);
  sess.headers = newHeaders.slice();
  sess.rows = sess.rows.map((row, i) => {
    const base = row.slice(0, 9);
    const p = pts[i];
    return [...base, p.cupPts, p.overallPts];
  });
}

fs.writeFileSync(eventPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
console.log('Updated', eventPath);
