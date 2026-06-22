import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/Users/cothe/.local/share/opencode/opencode.db');

// List all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log("=== TABLES ===");
console.log(JSON.stringify(tables, null, 2));

// Check columns in each table
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  const colNames = cols.map(c => c.name).join(', ');
  console.log(`\n${t.name}: cols=[${colNames}]`);
  
  // Check for image content in text/blob columns
  for (const c of cols) {
    if (c.type === 'text' || c.type === 'blob') {
      try {
        const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}" WHERE "${c.name}" LIKE '%image%' OR "${c.name}" LIKE '%FilePart%' OR "${c.name}" LIKE '%data:image%'`).get();
        if (count && count.cnt > 0) {
          console.log(`  → ${c.name} has ${count.cnt} image/FilePart matches`);
          const sample = db.prepare(`SELECT "${c.name}" FROM "${t.name}" WHERE "${c.name}" LIKE '%data:image%' OR "${c.name}" LIKE '%FilePart%' OR "${c.name}" LIKE '%mime%image%' LIMIT 3`).all();
          console.log(`  → samples: ${JSON.stringify(sample).substring(0, 500)}`);
        }
      } catch(e) {
        // skip unqueryable
      }
    }
  }
}

// Also check event table specifically
console.log("\n=== EVENT TABLE ===");
try {
  const evtCount = db.prepare("SELECT COUNT(*) as cnt FROM event").get();
  console.log(`event rows: ${JSON.stringify(evtCount)}`);
  const evtCols = db.prepare("PRAGMA table_info(event)").all();
  console.log(`event cols: ${JSON.stringify(evtCols.map(c => c.name))}`);
  // check event data
  const evtSample = db.prepare("SELECT id, data FROM event ORDER BY id DESC LIMIT 5").all();
  for (const e of evtSample) {
    console.log(`\nevent ${e.id}: ${JSON.stringify(e.data).substring(0, 300)}`);
  }
} catch(e) {
  console.log(`event table error: ${e.message}`);
}

db.close();
