/**
 * Isolated Postgres schema for integration tests. Uses DATABASE_URL (from the environment or
 * .env.local), creates a throwaway schema, runs migrations into it, and drops it afterwards.
 *
 * Supabase's pooler behaves like transaction mode: concurrent clients can share one server
 * session, so session state such as `SET search_path` leaks between them (seen in practice).
 * The returned `db` therefore runs every statement inside a transaction that starts with
 * `SET LOCAL search_path`, which is scoped to that transaction and cannot leak.
 */
import { Client, type QueryResult, type QueryResultRow } from 'pg';
import { buildPgConfig } from '@/lib/db/config';
import { runMigrations } from '@/lib/db/migrate';
import type { Queryable } from '@/lib/db/types';

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: integration suites are skipped.
  }
}

export const TEST_DATABASE_URL = process.env.DATABASE_URL;

export interface TestDatabase {
  /** Schema-scoped connection. Supports the app's own BEGIN/COMMIT/ROLLBACK calls. */
  db: Queryable;
  schema: string;
  /** Open another independently scoped connection for concurrent integration tests. */
  connect: () => Promise<{ db: Queryable; close: () => Promise<void> }>;
  cleanup: () => Promise<void>;
}

/** Wrap a client so every statement sees only `schema`, without touching session state. */
function schemaScoped(client: Client, schema: string): Queryable {
  let inTransaction = false;
  let queryQueue: Promise<void> = Promise.resolve();
  const setPath = `SET LOCAL search_path TO ${schema}`;

  return {
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
      const run = async (): Promise<QueryResult<R>> => {
        const command = text.trim().toUpperCase();
        if (command === 'BEGIN') {
          // One round trip: the remote test database is far away.
          await client.query(`BEGIN; ${setPath}`);
          inTransaction = true;
          return { command: 'BEGIN', rowCount: null, oid: 0, fields: [], rows: [] } as unknown as QueryResult<R>;
        }
        if (command === 'COMMIT' || command === 'ROLLBACK') {
          inTransaction = false;
          return client.query<R>(text);
        }
        if (inTransaction) return client.query<R>(text, values);

        // Standalone statement: give it its own transaction.
        await client.query(`BEGIN; ${setPath}`);
        try {
          const result = await client.query<R>(text, values);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      };
      const result = queryQueue.then(run, run);
      queryQueue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const schema = `winback_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const client = new Client(buildPgConfig(TEST_DATABASE_URL));
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  const db = schemaScoped(client, schema);
  await runMigrations(db);

  return {
    db,
    schema,
    connect: async () => {
      const connection = new Client(buildPgConfig(TEST_DATABASE_URL));
      await connection.connect();
      return { db: schemaScoped(connection, schema), close: () => connection.end() };
    },
    cleanup: async () => {
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await client.end();
      }
    },
  };
}
