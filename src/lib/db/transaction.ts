import type { Queryable } from './types';

/** Run `fn` in a transaction. `db` must be a single connection (Client/PoolClient), not a Pool. */
export async function inTransaction<T>(db: Queryable, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
