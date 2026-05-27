node -e @"
const sqlite3 = require('node:sqlite');
const db = new sqlite3.DatabaseSync('C:\\Users\\cothe\\.local\\share\\opencode\\opencode.db');

console.log('=== Most recent 25 root sessions (parent_id IS NULL) ALL directories ===');
console.log('id\tdirectory\ttime_created\ttitle');
const rows1 = db.prepare("SELECT id, directory, time_created, IFNULL(SUBSTR(title, 1, 60), '') as title FROM session WHERE parent_id IS NULL ORDER BY time_created DESC LIMIT 25").all();
for (const r of rows1) {
  console.log(r.id + '\t' + r.directory + '\t' + r.time_created + '\t' + r.title);
}

console.log('\n=== Count by directory for root sessions ===');
console.log('directory\tsessions');
const rows2 = db.prepare("SELECT directory, COUNT(*) as sessions FROM session WHERE parent_id IS NULL GROUP BY directory ORDER BY sessions DESC").all();
for (const r of rows2) {
  console.log(r.directory + '\t' + r.sessions);
}

console.log('\n=== Check if any NEW session directories exist ===');
const rows3 = db.prepare("SELECT DISTINCT directory FROM session WHERE directory NOT LIKE 'E:/%' AND directory NOT LIKE 'C:/%' AND directory NOT LIKE 'E:\\%'").all();
console.log(JSON.stringify(rows3));
"@
