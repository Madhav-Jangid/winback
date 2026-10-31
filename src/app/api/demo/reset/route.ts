import { NextResponse } from 'next/server';
import { query } from '@/lib/db/pool';
import { createHash } from 'crypto';

const DEMO_MERCHANT_ID = '00000000-0000-0000-0000-000000000001';
const REFERENCE_DATE = new Date('2026-10-01T00:00:00Z');

function daysAgo(n: number): Date {
  const d = new Date(REFERENCE_DATE);
  d.setDate(d.getDate() - n);
  return d;
}

function hashId(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-8${h.slice(15, 18)}-${h.slice(18, 30)}`;
}

const DEMO_CUSTOMERS = [
  { name: 'Arjun Sharma', lang: 'hi', consent: 'consented', purchases: [daysAgo(90), daysAgo(45)] },
  { name: 'Priya Patel', lang: 'gu', consent: 'consented', purchases: [daysAgo(80), daysAgo(40), daysAgo(10)] },
  { name: 'Ravi Kumar', lang: 'ta', consent: 'consented', purchases: [daysAgo(120), daysAgo(60)] },
  { name: 'Sunita Rao', lang: 'te', consent: 'consented', purchases: [daysAgo(100), daysAgo(50)] },
  { name: 'Mohammed Ali', lang: 'hi', consent: 'consented', purchases: [daysAgo(70), daysAgo(35), daysAgo(5)] },
  { name: 'Deepa Nair', lang: 'ml', consent: 'consented', purchases: [daysAgo(60), daysAgo(30)] },
  { name: 'Vikram Singh', lang: 'hi', consent: 'consented', purchases: [daysAgo(200), daysAgo(100)] },
  { name: 'Ananya Das', lang: 'bn', consent: 'consented', purchases: [daysAgo(55), daysAgo(25), daysAgo(3)] },
  { name: 'Sanjay Mehta', lang: 'mr', consent: 'consented', purchases: [daysAgo(90), daysAgo(45)] },
  { name: 'Kavitha Reddy', lang: 'te', consent: 'consented', purchases: [daysAgo(150), daysAgo(75)] },
  { name: 'Rohit Verma', lang: 'hi', consent: 'consented', purchases: [daysAgo(30)] },
  { name: 'Meena Krishnan', lang: 'ta', consent: 'consented', purchases: [] },
  { name: 'Arun Joshi', lang: 'hi', consent: 'consented', purchases: [daysAgo(80), daysAgo(40)], optedOut: true },
  { name: 'Fatima Sheikh', lang: 'hi', consent: 'consented', purchases: [daysAgo(60), daysAgo(30)], optedOut: true },
  { name: 'Ramesh Gupta', lang: 'hi', consent: 'unknown', purchases: [daysAgo(90), daysAgo(45)] },
  { name: 'Sushma Iyer', lang: 'ta', consent: 'unknown', purchases: [daysAgo(70), daysAgo(35)] },
  { name: 'Dinesh Pillai', lang: 'ml', consent: 'revoked', purchases: [daysAgo(100), daysAgo(50)] },
  { name: 'Nisha Mishra', lang: 'hi', consent: 'consented', purchases: [daysAgo(110), daysAgo(55)] },
  { name: 'Ganesh Nair', lang: 'ml', consent: 'consented', purchases: [daysAgo(130), daysAgo(65)] },
  { name: 'Rekha Choudhary', lang: 'hi', consent: 'consented', purchases: [daysAgo(85), daysAgo(42)] },
  { name: 'Amrit Kaur', lang: 'pa', consent: 'consented', purchases: [daysAgo(30), daysAgo(15), daysAgo(2)] },
  { name: 'Vikas Tiwari', lang: 'hi', consent: 'consented', purchases: [daysAgo(40), daysAgo(20), daysAgo(4)] },
  { name: 'Pooja Bhat', lang: 'kn', consent: 'consented', purchases: [daysAgo(35), daysAgo(18), daysAgo(1)] },
  { name: 'Suresh Pandey', lang: 'hi', consent: 'consented', purchases: [daysAgo(50), daysAgo(25), daysAgo(6)] },
  { name: 'Lakshmi Venkat', lang: 'te', consent: 'consented', purchases: [daysAgo(45), daysAgo(22), daysAgo(5)] },
];

export async function POST() {
  try {
    // Clean existing demo data
    await query(`DELETE FROM audit_events WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM campaign_outcomes WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM campaign_messages WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM campaign_recipients WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM campaigns WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM purchases WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM customers WHERE merchant_id = $1`, [DEMO_MERCHANT_ID]);
    await query(`DELETE FROM merchants WHERE id = $1`, [DEMO_MERCHANT_ID]);

    // Seed merchant
    await query(
      `INSERT INTO merchants (id, name, business_type, currency, default_budget_minor, default_cooldown_days, default_frequency_cap)
       VALUES ($1, 'Chai & Conversations Café', 'cafe', 'INR', 5000000, 30, 1)`,
      [DEMO_MERCHANT_ID],
    );

    // Seed customers and purchases
    for (let i = 0; i < DEMO_CUSTOMERS.length; i++) {
      const c = DEMO_CUSTOMERS[i];
      const customerId = hashId(`customer-${i}-${c.name}`);
      const optedOutAt = c.optedOut ? daysAgo(20).toISOString() : null;

      await query(
        `INSERT INTO customers (id, merchant_id, display_name, preferred_language, consent_status, opted_out_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [customerId, DEMO_MERCHANT_ID, c.name, c.lang, c.consent, optedOutAt],
      );

      for (let j = 0; j < c.purchases.length; j++) {
        const purchaseId = hashId(`purchase-${i}-${j}-${c.name}`);
        const amount = 15000 + Math.abs(Math.floor(Math.sin(i * 7 + j) * 5000));
        await query(
          `INSERT INTO purchases (id, merchant_id, customer_id, occurred_at, amount_minor, currency, status, source)
           VALUES ($1, $2, $3, $4, $5, 'INR', 'completed', 'demo')`,
          [purchaseId, DEMO_MERCHANT_ID, customerId, c.purchases[j].toISOString(), amount],
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: '✅ Demo data reset successfully. Seeded 25 customers with varied purchase histories.',
      customers: DEMO_CUSTOMERS.length,
    });
  } catch (err) {
    console.error('[Demo Reset API]', err);
    return NextResponse.json(
      { error: { code: 'RESET_FAILED', message: 'Demo reset failed. Is the database running?' } },
      { status: 503 },
    );
  }
}
