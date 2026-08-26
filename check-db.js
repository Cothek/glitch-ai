const DatabaseSync = require('node:sqlite').DatabaseSync;
const dbPath = 'C:\\Users\\cothe\\.local\\share\\opencode\\opencode.db';
console.log('Using DB path:', dbPath);
const db = new DatabaseSync(dbPath, { readonly: true });

// Check if the session exists
const row = db.prepare('SELECT * FROM part WHERE session_id = ?').get('ses_fe89aaad0ffeYAaimbyUJqoOVQ');
console.log('Row found:', row ? 'yes' : 'no');
if (row) {
  console.log('data length:', row.data ? row.data.length : 0);
  if (row.data) {
    try {
      const parsed = JSON.parse(row.data);
      console.log('state.status:', parsed.state ? parsed.state.status : 'no state');
      console.log('tool:', parsed.tool ? parsed.tool : 'no tool');
    } catch(e) {
      console.log('JSON parse error:', e.message);
    }
  }
}

// Also check all sessions to understand the data
const allRows = db.prepare('SELECT session_id, time_updated FROM part ORDER BY time_updated DESC LIMIT 20').all();
console.log('\nLast 20 sessions:');
allRows.forEach(r => console.log(' -', r.session_id, 'at', r.time_updated));

db.close();