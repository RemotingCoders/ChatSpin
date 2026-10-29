import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repository, validateState } from './storage.js';
if (!process.argv[2]) throw new Error('Supply the path to a session backup. Stop ChatSpin first.');
const restored = validateState(JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8')));
process.umask(0o077);
const repository = new Repository(
  resolve(process.env.DATA_FILE || 'data/state.json'),
  process.env.SESSION_SECRET,
);
try {
  try {
    repository.snapshot(repository.load());
  } catch {
    repository.db
      .prepare(
        'INSERT INTO records(id,value) SELECT ?,value FROM records WHERE id=? ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run('pre-restore-invalid-state', 'state');
  }
  repository.save(restored);
  console.log('Backup restored. Existing credentials and OBS link were kept.');
} finally {
  repository.db.close();
}
