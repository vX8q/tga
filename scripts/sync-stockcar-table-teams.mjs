/**
 * Sync Team / Official Team columns from entry_list (car number -> team)
 * for stock-car event JSON: practice, qualifying, race_results, stage_*.
 *
 * Run from repo root: node scripts/sync-stockcar-table-teams.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'data', 'events');

function isStockCarRel(rel) {
  const l = rel.replace(/\\/g, '/').toLowerCase();
  return (
    l.includes('nascar cup series') ||
    l.includes('nascar truck') ||
    l.includes('noaps') ||
    l.includes('/arca/') ||
    l.includes('arca/') ||
    l.includes('nascar modified')
  );
}

function walkJsonFiles(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsonFiles(p, base, out);
    else if (ent.name.endsWith('.json')) {
      const rel = path.relative(base, p);
      if (isStockCarRel(rel)) out.push(p);
    }
  }
  return out;
}

function normHeader(h) {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
}

function headerIndex(headers, candidates) {
  const lows = headers.map(normHeader);
  for (const c of candidates) {
    const want = normHeader(c);
    const i = lows.indexOf(want);
    if (i >= 0) return i;
  }
  return -1;
}

function buildTeamMap(entryList) {
  const m = new Map();
  if (!Array.isArray(entryList)) return m;
  for (const e of entryList) {
    const num = String(e?.number ?? '').trim();
    const team = String(e?.team ?? '').trim();
    if (num && team) m.set(num, team);
  }
  return m;
}

function lookupTeam(map, carRaw) {
  const car = String(carRaw ?? '').trim();
  if (!car || car === '—' || car === '-') return null;
  if (map.has(car)) return map.get(car);
  if (!/^\d+$/.test(car)) return null;
  const n = parseInt(car, 10);
  if (Number.isNaN(n)) return null;
  const tries = [String(n), String(n).padStart(2, '0'), String(n).padStart(3, '0')];
  for (const k of tries) {
    if (map.has(k)) return map.get(k);
  }
  return null;
}

const CAR_HEADERS = ['car', 'no', 'no.', '#', 'trk'];
const TEAM_HEADERS = ['team', 'official team'];

function syncTable(table, teamMap) {
  if (!table || typeof table !== 'object') return false;
  const headers = table.headers;
  const rows = table.rows;
  if (!Array.isArray(headers) || !Array.isArray(rows)) return false;

  const carIdx = headerIndex(headers, CAR_HEADERS);
  const teamIdx = headerIndex(headers, TEAM_HEADERS);
  if (carIdx < 0 || teamIdx < 0) return false;

  let changed = false;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length <= Math.max(carIdx, teamIdx)) continue;
    const car = row[carIdx];
    const t = lookupTeam(teamMap, car);
    if (t == null) continue;
    const old = String(row[teamIdx] ?? '');
    if (old !== t) {
      row[teamIdx] = t;
      changed = true;
    }
  }
  return changed;
}

function processFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return false;
  }
  const teamMap = buildTeamMap(obj.entry_list);
  if (teamMap.size === 0) return false;

  const tables = obj.tables;
  if (!tables || typeof tables !== 'object') return false;

  const keys = Object.keys(tables).filter(
    (k) =>
      k === 'practice' ||
      k === 'qualifying' ||
      k === 'race_results' ||
      /^stage_\d+$/.test(k)
  );

  let any = false;
  for (const k of keys) {
    if (syncTable(tables[k], teamMap)) any = true;
  }
  if (!any) return false;

  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return true;
}

const files = walkJsonFiles(ROOT);
let n = 0;
for (const f of files) {
  if (processFile(f)) {
    n++;
    console.log('updated', path.relative(process.cwd(), f));
  }
}
console.log('done, files updated:', n, 'of', files.length, 'candidates');
