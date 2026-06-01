import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';

// opencode DB is at ~/.local/share/opencode/opencode.db
const dbPath = join(process.env.USERPROFILE, '.local', 'share', 'opencode', 'opencode.db');

try {
  const db = new DatabaseSync(dbPath.replace(/\\/g, '/'));
  
  const sessionResult = db.prepare(
    "UPDATE session SET directory = REPLACE(directory, '\\', '/') WHERE INSTR(directory, '\\') > 0"
  ).run();
  
  const projectResult = db.prepare(
    "UPDATE project SET worktree = REPLACE(worktree, '\\', '/') WHERE INSTR(worktree, '\\') > 0"
  ).run();
  
  console.log(`Fixed ${sessionResult.changes} session(s), ${projectResult.changes} project(s)`);
  db.close();
} catch (e) {
  console.error('fix-paths error:', e.message);
  process.exit(1);
}
