import type { ClientConfig } from 'pg';

function hostOf(connectionString: string): string {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return '';
  }
}

/**
 * Supabase's pooler behaves like transaction mode: server sessions are shared between client
 * connections, even concurrent ones. The app must never rely on session state (SET, temp
 * tables, named prepared statements); transactions are safe because the pooler pins a server
 * session for their duration. As a safeguard against settings leaked by other clients, new
 * connections reset search_path.
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
