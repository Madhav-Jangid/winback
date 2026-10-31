import type { ClientConfig } from 'pg';

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return '';
  }
}

/**
 * Supabase's pooler reuses server sessions between client connections, so session settings
 * such as search_path can leak in from a previous client (e.g. an integration test's temp
 * schema). Run this first on every new connection to restore the database defaults.
 */
export const RESET_SESSION_SQL = 'RESET search_path';

/**
 * Connection settings shared by the app pool, scripts, and integration tests.
 * Supabase connections are encrypted. The certificate is not verified (MVP limitation;
 * documented in the README), which still prevents passive eavesdropping.
 */
export function buildPgConfig(connectionString: string): ClientConfig {
  const host = hostOf(connectionString);
  const isSupabase = host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  return {
    connectionString,
    ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000,
  };
}
