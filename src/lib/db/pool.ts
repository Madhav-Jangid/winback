import { Pool } from 'pg';
import { getServerEnv } from '@/lib/env';
import { buildPgConfig, RESET_SESSION_SQL } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = getServerEnv().DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      ...buildPgConfig(connectionString),
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // pg queues queries per client, so this runs before any app query on the connection.
    pool.on('connect', (client) => {
      client.query(RESET_SESSION_SQL).catch((err) => console.error('Failed to reset DB session', err));
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
