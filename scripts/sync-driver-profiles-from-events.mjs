import fs from "fs";
import path from "path";

const root = process.cwd();
const eventsDir = path.join(root, "data", "events");
const profilesPath = path.join(root, "data", "driver_profiles.json");

const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
const names = new Set();

function shouldSkip(raw) {
  const t = String(raw ?? "").trim();
  if (!t) return true;
  const l = t.toLowerCase();
  return (
    l === "driver" ||
    l === "drivers" ||
    l.includes("qualified by") ||
    l.includes("failed to qualify")
  );
}

function pushName(raw) {
  if (typeof raw !== "string") return;
  for (const part of raw.split(/[;,/]|\\s+&\\s+/g)) {
    const name = part.trim();
    if (!shouldSkip(name)) {
      names.add(name);
    }
  }
}

function harvestTable(headers, rows) {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return;
  const idx = [];
  headers.forEach((h, i) => {
    const t = String(h ?? "").trim().toLowerCase();
    if (
      t === "driver" ||
      t === "drivers" ||
      t === "driver 1" ||
      t === "driver 2" ||
      t === "driver 3"
    ) {
      idx.push(i);
    }
  });
  if (!idx.length) return;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const i of idx) {
      if (i < row.length) {
        pushName(String(row[i] ?? ""));
      }
    }
  }
}

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(p);
      continue;
    }
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith(".json")) {
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }

    if (Array.isArray(obj?.entry_list)) {
      for (const row of obj.entry_list) {
        if (!row || typeof row !== "object") continue;
        for (const [k, v] of Object.entries(row)) {
          const key = k.toLowerCase();
          if (key === "driver" || /^driver\d+$/.test(key)) {
            if (typeof v === "string") pushName(v);
          }
          if (key === "drivers" && Array.isArray(v)) {
            for (const d of v) pushName(String(d ?? ""));
          }
        }
      }
    }

    if (obj?.tables && typeof obj.tables === "object") {
      for (const table of Object.values(obj.tables)) {
        if (!table || typeof table !== "object") continue;
        harvestTable(table.headers, table.rows);
        if (Array.isArray(table.sessions)) {
          for (const session of table.sessions) {
            if (!session || typeof session !== "object") continue;
            harvestTable(session.headers, session.rows);
          }
        }
      }
    }
  }
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

walk(eventsDir);

let added = 0;
let removedComposite = 0;
for (const name of names) {
  const slug = slugify(name);
  if (!slug) continue;
  if (!profiles[slug]) {
    profiles[slug] = {
      full_name: name,
      birth_date: "",
      birth_place: "",
      citizenship: "",
      photo_url: "",
    };
    added++;
  }
}

for (const [slug, profile] of Object.entries(profiles)) {
  const fullName = String(profile?.full_name ?? "").trim();
  const isComposite = /[;/]/.test(fullName);
  const hasOnlyGeneratedData =
    String(profile?.birth_date ?? "") === "" &&
    String(profile?.birth_place ?? "") === "" &&
    String(profile?.citizenship ?? "") === "" &&
    String(profile?.photo_url ?? "") === "";
  if (isComposite && hasOnlyGeneratedData) {
    delete profiles[slug];
    removedComposite++;
  }
}

const ordered = {};
for (const key of Object.keys(profiles).sort()) {
  ordered[key] = profiles[key];
}

fs.writeFileSync(profilesPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    drivers_found: names.size,
    added,
    removed_composite: removedComposite,
    total: Object.keys(ordered).length,
  }),
);
