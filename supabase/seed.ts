#!/usr/bin/env node
/**
 * Winback AI — Deterministic Demo Seed Script
 * Usage: npx ts-node -e "require('./supabase/seed')" or via npm run db:seed
 *
 * Seeds a full demo dataset: 1 merchant, ~30 customers, purchases, etc.
 * Designed to be safely repeatable (idempotent via DELETE + INSERT pattern).
 * Uses a fixed reference date of 2026-10-01 so dates don't stale.
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';

const REFERENCE_DATE = new Date('2026-10-01T00:00:00Z');
const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';

function daysAgo(n: number): Date {
  const d = new Date(REFERENCE_DATE);
  d.setDate(d.getDate() - n);
  return d;
}

function hashId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 8) +
    '-' + createHash('sha256').update(seed + '1').digest('hex').slice(0, 4) +
    '-4' + createHash('sha256').update(seed + '2').digest('hex').slice(0, 3) +
    '-8' + createHash('sha256').update(seed + '3').digest('hex').slice(0, 3) +
    '-' + createHash('sha256').update(seed + '4').digest('hex').slice(0, 12);
}

const DEMO_CUSTOMERS = [
  // At-risk customers (2+ purchases, but overdue)
  { name: 'Arjun Sharma', lang: 'hi', consent: 'consented', purchases: [daysAgo(90), daysAgo(45)], note: 'at-risk' },
  { name: 'Priya Patel', lang: 'gu', consent: 'consented', purchases: [daysAgo(80), daysAgo(40), daysAgo(10)], note: 'healthy' },
  { name: 'Ravi Kumar', lang: 'ta', consent: 'consented', purchases: [daysAgo(120), daysAgo(60)], note: 'at-risk' },
  { name: 'Sunita Rao', lang: 'te', consent: 'consented', purchases: [daysAgo(100), daysAgo(50)], note: 'at-risk' },
  { name: 'Mohammed Ali', lang: 'hi', consent: 'consented', purchases: [daysAgo(70), daysAgo(35), daysAgo(5)], note: 'healthy' },
  { name: 'Deepa Nair', lang: 'ml', consent: 'consented', purchases: [daysAgo(60), daysAgo(30)], note: 'at-risk' },
  { name: 'Vikram Singh', lang: 'hi', consent: 'consented', purchases: [daysAgo(200), daysAgo(100)], note: 'at-risk' },
  { name: 'Ananya Das', lang: 'bn', consent: 'consented', purchases: [daysAgo(55), daysAgo(25), daysAgo(3)], note: 'healthy' },
  { name: 'Sanjay Mehta', lang: 'mr', consent: 'consented', purchases: [daysAgo(90), daysAgo(45)], note: 'at-risk' },
  { name: 'Kavitha Reddy', lang: 'te', consent: 'consented', purchases: [daysAgo(150), daysAgo(75)], note: 'at-risk' },
  // Insufficient history
  { name: 'Rohit Verma', lang: 'hi', consent: 'consented', purchases: [daysAgo(30)], note: 'insufficient-history' },
  { name: 'Meena Krishnan', lang: 'ta', consent: 'consented', purchases: [], note: 'insufficient-history' },
  // Opted out
  { name: 'Arun Joshi', lang: 'hi', consent: 'consented', purchases: [daysAgo(80), daysAgo(40)], optedOut: true, note: 'opted-out' },
  { name: 'Fatima Sheikh', lang: 'hi', consent: 'consented', purchases: [daysAgo(60), daysAgo(30)], optedOut: true, note: 'opted-out' },
  // No consent / unknown
  { name: 'Ramesh Gupta', lang: 'hi', consent: 'unknown', purchases: [daysAgo(90), daysAgo(45)], note: 'no-consent' },
  { name: 'Sushma Iyer', lang: 'ta', consent: 'unknown', purchases: [daysAgo(70), daysAgo(35)], note: 'no-consent' },
  // Revoked
  { name: 'Dinesh Pillai', lang: 'ml', consent: 'revoked', purchases: [daysAgo(100), daysAgo(50)], note: 'revoked' },
  // More at-risk
  { name: 'Nisha Mishra', lang: 'hi', consent: 'consented', purchases: [daysAgo(110), daysAgo(55)], note: 'at-risk' },
  { name: 'Ganesh Nair', lang: 'ml', consent: 'consented', purchases: [daysAgo(130), daysAgo(65)], note: 'at-risk' },
  { name: 'Rekha Choudhary', lang: 'hi', consent: 'consented', purchases: [daysAgo(85), daysAgo(42)], note: 'at-risk' },
  // Healthy (purchased recently)
  { name: 'Amrit Kaur', lang: 'pa', consent: 'consented', purchases: [daysAgo(30), daysAgo(15), daysAgo(2)], note: 'healthy' },
  { name: 'Vikas Tiwari', lang: 'hi', consent: 'consented', purchases: [daysAgo(40), daysAgo(20), daysAgo(4)], note: 'healthy' },
  { name: 'Pooja Bhat', lang: 'kn', consent: 'consented', purchases: [daysAgo(35), daysAgo(18), daysAgo(1)], note: 'healthy' },
  { name: 'Suresh Pandey', lang: 'hi', consent: 'consented', purchases: [daysAgo(50), daysAgo(25), daysAgo(6)], note: 'healthy' },
  { name: 'Lakshmi Venkat', lang: 'te', consent: 'consented', purchases: [daysAgo(45), daysAgo(22), daysAgo(5)], note: 'healthy' },
];

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('🌱 Starting Winback AI demo seed...');

    await pool.query('BEGIN');

    // Clean existing demo data
    console.log('  Cleaning existing demo data...');
    await pool.query(`DELETE FROM audit_events WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await pool.query(`DELETE FROM provider_operations WHERE created_at < NOW()`);
    await pool.query(`
      DELETE FROM campaign_outcomes WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)
    `, [DEMO_MERCHANT_ID]);
    await pool.query(`
      DELETE FROM campaign_messages WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)
    `, [DEMO_MERCHANT_ID]);
    await pool.query(`
      DELETE FROM campaign_recipients WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)
    `, [DEMO_MERCHANT_ID]);
    await pool.query(`DELETE FROM campaigns WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await pool.query(`
      DELETE FROM purchases WHERE merchant_id = $1
    `, [DEMO_MERCHANT_ID]);
    await pool.query(`DELETE FROM customers WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await pool.query(`DELETE FROM merchants WHERE id = $1`, [DEMO_MERCHANT_ID]);

    // Seed merchant
    console.log('  Seeding merchant...');
    await pool.query(`
      INSERT INTO merchants (id, name, business_type, currency, default_budget_minor, default_cooldown_days, default_frequency_cap)
      VALUES ($1, 'Chai & Conversations Café', 'cafe', 'INR', 5000000, 30, 1)
    `, [DEMO_MERCHANT_ID]);

    // Seed customers and purchases
    console.log(`  Seeding ${DEMO_CUSTOMERS.length} customers...`);
    for (let i = 0; i < DEMO_CUSTOMERS.length; i++) {
      const c = DEMO_CUSTOMERS[i];
      const customerId = hashId(`customer-${i}-${c.name}`);
      const optedOutAt = c.optedOut ? daysAgo(20).toISOString() : null;

      await pool.query(`
        INSERT INTO customers (id, merchant_id, display_name, preferred_language, consent_status, opted_out_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [customerId, DEMO_MERCHANT_ID, c.name, c.lang, c.consent, optedOutAt]);

      for (let j = 0; j < (c.purchases || []).length; j++) {
        const purchaseId = hashId(`purchase-${i}-${j}-${c.name}`);
        const amount = 15000 + Math.floor(Math.sin(i * 7 + j) * 5000);
        await pool.query(`
          INSERT INTO purchases (id, merchant_id, customer_id, occurred_at, amount_minor, currency, status, source)
          VALUES ($1, $2, $3, $4, $5, 'INR', 'completed', 'demo')
        `, [purchaseId, DEMO_MERCHANT_ID, customerId, c.purchases[j].toISOString(), Math.abs(amount)]);
      }
    }

    await pool.query('COMMIT');
    console.log('✅ Demo seed completed successfully!');
    console.log(`   Merchant: Chai & Conversations Café (${DEMO_MERCHANT_ID})`);
    console.log(`   Customers: ${DEMO_CUSTOMERS.length}`);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
