import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Queryable } from './types';

export const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');

/**
 * Apply pending SQL migrations in filename order, each in its own transaction.
 * `db` must be a single connection (Client or PoolClient), not a Pool, so BEGIN/COMMIT apply.
 * Returns the names of migrations applied by this call.
 */
export async function runMigrations(db: Queryable, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query('ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY');

  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
    ran.push(file);
  }
  return ran;
}
