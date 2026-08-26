const DatabaseSync = require('node:sqlite').DatabaseSync;
const dbPath = 'C:\\Users\\cothe\\.local\\share\\opencode\\opencode.db';
const db = new DatabaseSync(dbPath, { readonly: true });

// Check the specific session
const sessionID = 'ses_fe89aaad0ffeYAaimbyUJqoOVQ';
console.log('Checking session:', sessionID);

// The exact query used by isSessionToolRunning
const query = `SELECT data FROM part WHERE session_id = ? AND json_extract(data, '$.state.status') = 'running' ORDER BY time_updated DESC LIMIT 1`;
const row = db.prepare(query).get(sessionID);
console.log('Query result:', row ? 'row found' : 'no row');

// If no row from the running check, try without the state filter
const row2 = db.prepare('SELECT data FROM part WHERE session_id = ? ORDER BY time_updated DESC LIMIT 1').get(sessionID);
console.log('Full row data found:', row2 ? 'yes' : 'no');
if (row2 && row2.data) {
  console.log('Data:', row2.data);
  try {
    const parsed = JSON.parse(row2.data);
    console.log('Parsed state:', parsed.state);
    console.log('Parsed state.status:', parsed.state ? parsed.state.status : 'no status field');
    console.log('Parsed tool:', parsed.tool);
  } catch(e) {
    console.log('JSON parse error:', e.message);
  }
  
  // Try json_extract directly
  try {
    const extracted = db.prepare("SELECT json_extract(data, '$.state.status') as status FROM part WHERE session_id = ?").get(sessionID);
    console.log('json_extract result:', extracted ? extracted.status : 'null');
  } catch(e) {
    console.log('json_extract error:', e.message);
  }
}

// Check all part table schema/columns
try {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='part'").get();
  console.log('Schema:', schema ? schema.sql : 'not found');
} catch(e) {
  console.log('Schema error:', e.message);
}

// Check distinct status values
try {
  const statuses = db.prepare("SELECT DISTINCT json_extract(data, '$.state.status') as status FROM part WHERE json_extract(data, '$.state.status') IS NOT NULL").all();
  console.log('Distinct statuses:', statuses.map(r => r.status));
} catch(e) {
  console.log('Status query error:', e.message);
}

// Check if any part has status='running'
try {
  const runningCount = db.prepare("SELECT COUNT(*) as cnt FROM part WHERE json_extract(data, '$.state.status') = 'running'").get();
  console.log('Count with status=running:', runningCount ? runningCount.cnt : 0);
} catch(e) {
  console.log('Running count error:', e.message);
}

db.close();