/** Apply pending migrations in supabase/migrations to DATABASE_URL. Usage: npm run db:migrate */
import { loadEnvConfig } from '@next/env';
import { Client } from 'pg';
import { buildPgConfig } from '@/lib/db/config';
import { runMigrations } from '@/lib/db/migrate';

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Add it to .env.local (see README).');

  const client = new Client(buildPgConfig(url));
  await client.connect();
  try {
    const ran = await runMigrations(client);
    console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
