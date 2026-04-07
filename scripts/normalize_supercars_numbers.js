/**
 * Нормализация номеров машин Supercars: 01→1, 02→2, 08→8 и т.д.
 * Прогон по events/supercars_*.json (entry_list + все таблицы) и teams/supercars.json
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function normalizeNumber(val) {
  if (val == null) return val;
  const s = String(val).trim();
  if (!/^\d+$/.test(s)) return val;
  const n = parseInt(s, 10);
  return String(n);
}

function findNumberColumnIndex(headers) {
  if (!Array.isArray(headers)) return -1;
  const noLabels = ['no.', 'no', 'car no', 'car no.'];
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || '').toLowerCase().trim();
    if (noLabels.includes(h)) return i;
  }
  return -1;
}

function processEventFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  let changed = false;

  if (Array.isArray(data.entry_list)) {
    data.entry_list.forEach((row) => {
      if (row.number != null) {
        const norm = normalizeNumber(row.number);
        if (norm !== row.number) {
          row.number = norm;
          changed = true;
        }
      }
    });
  }

  const tables = data.tables;
  if (tables && typeof tables === 'object') {
    for (const key of Object.keys(tables)) {
      const t = tables[key];
      if (!t) continue;

      function processRows(headers, rows) {
        if (!Array.isArray(rows)) return;
        const idx = findNumberColumnIndex(headers);
        if (idx < 0) return;
        rows.forEach((row) => {
          if (Array.isArray(row) && row[idx] != null) {
            const norm = normalizeNumber(row[idx]);
            if (norm !== row[idx]) {
              row[idx] = norm;
              changed = true;
            }
          }
        });
      }

      if (Array.isArray(t.sessions)) {
        t.sessions.forEach((sess) => {
          processRows(sess.headers, sess.rows);
        });
      } else {
        processRows(t.headers, t.rows);
      }
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log('Updated:', filePath);
  }
}

function processTeamsFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  let changed = false;

  if (Array.isArray(data.teams)) {
    data.teams.forEach((team) => {
      if (team.number != null) {
        const norm = normalizeNumber(team.number);
        if (norm !== team.number) {
          team.number = norm;
          changed = true;
        }
      }
    });
  }

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log('Updated:', filePath);
  }
}

// Events
const eventsDir = path.join(DATA_DIR, 'events');
const eventFiles = fs.readdirSync(eventsDir).filter((f) => f.startsWith('supercars_') && f.endsWith('.json'));
eventFiles.forEach((f) => processEventFile(path.join(eventsDir, f)));

// Teams
const teamsPath = path.join(DATA_DIR, 'teams', 'supercars.json');
if (fs.existsSync(teamsPath)) processTeamsFile(teamsPath);

console.log('Done.');
