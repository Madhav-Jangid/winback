/** Reset the demo workspace to the known seed state. Usage: npm run db:seed */
import { loadEnvConfig } from '@next/env';
import { Client } from 'pg';
import { buildPgConfig } from '@/lib/db/config';
import { resetDemoData } from '@/lib/demo/seed';

async function main() {
  loadEnvConfig(process.cwd());
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Add it to .env.local (see README).');
  if ((process.env.DEMO_MODE ?? 'true') !== 'true') throw new Error('Refusing to seed: DEMO_MODE is not true.');

  const client = new Client(buildPgConfig(url));
  await client.connect();
  try {
    const summary = await resetDemoData(client, 'seed-script');
    console.log('Demo data seeded:', summary);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
