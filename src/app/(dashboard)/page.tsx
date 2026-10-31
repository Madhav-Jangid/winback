'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface DashboardData {
  total_customers: number;
  at_risk_customers: number;
  draft_campaigns: number;
  completed_campaigns: number;
  total_simulated_reactivations: number;
  total_estimated_revenue_minor: number;
  recent_campaigns: Array<{
    id: string;
    name: string;
    status: string;
    updated_at: string;
    channel: string;
    language: string;
  }>;
  is_demo: boolean;
  as_of: string;
  merchant_name: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  planning: 'Planning',
  ready_for_approval: 'Ready for Approval',
  approved: 'Approved',
  sending: 'Sending…',
  sent: 'Sent',
  measuring: 'Measuring',
  completed: '✅ Completed',
  cancelled: 'Cancelled',
  failed: '⚠️ Failed',
};

function formatCurrency(minor: number) {
  return `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to load dashboard.');
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error.');
    } finally {
      setLoading(false);
    }
  };

  const resetDemo = async () => {
    setResetting(true);
    setResetMessage(null);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Reset failed.');
      setResetMessage(json.message);
      await loadDashboard();
    } catch (e) {
      setResetMessage(`❌ ${e instanceof Error ? e.message : 'Reset failed.'}`);
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard')
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || 'Failed to load dashboard.');
        }
        return res.json() as Promise<DashboardData>;
      })
      .then((dashboard) => { if (active) setData(dashboard); })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unknown error.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, []);

  return (
    <div className="fade-in">
      <div className="demo-banner">
        <span>⚡</span>
        <span>
          <strong>Demo Mode:</strong> All data is simulated. No real customers, purchases, or messages.{' '}
          <button
            onClick={resetDemo}
            disabled={resetting}
            style={{ background: 'none', border: 'none', color: 'var(--warning)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            {resetting ? 'Resetting…' : 'Reset demo data'}
          </button>
        </span>
      </div>

      {resetMessage && (
        <div className={`success-box mb-4`} style={{ marginBottom: '1rem' }}>
          <span>✅</span>
          <span>{resetMessage}</span>
        </div>
      )}

      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {data?.merchant_name ? `${data.merchant_name} · ` : ''}Overview of your customer retention performance
          </p>
          {data?.is_demo && (
            <p className="form-help" style={{ marginTop: '0.25rem' }}>
              Risk is calculated as of{' '}
              {new Date(data.as_of).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}
              {' '}(fixed demo date, so the demo stays consistent).
            </p>
          )}
        </div>
        <Link href="/campaigns/new" className="btn btn-primary">
          ＋ New Campaign
        </Link>
      </div>

      {loading && (
        <div className="center-content">
          <div className="loading-spinner" />
          <p className="empty-desc">Loading dashboard…</p>
        </div>
      )}

      {error && (
        <div className="error-box" style={{ marginBottom: '1.5rem' }}>
          <span>⚠️</span>
          <div>
            <strong>Database connection error</strong>
            <p style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>{error}</p>
            <p style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>Set DATABASE_URL in .env.local, then run <code>npm run db:setup</code>.</p>
            <button onClick={loadDashboard} className="btn btn-secondary" style={{ marginTop: '0.75rem' }}>Retry</button>
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
            <Link href="/customers" style={{ textDecoration: 'none' }}>
              <div className="kpi-card">
                <span className="kpi-icon">👥</span>
                <div className="kpi-label">Total Customers</div>
                <div className="kpi-value">{data.total_customers.toLocaleString()}</div>
                <div className="kpi-sub">In demo dataset</div>
              </div>
            </Link>
            <Link href="/customers?filter=at_risk" style={{ textDecoration: 'none' }}>
              <div className="kpi-card">
                <span className="kpi-icon">⚠️</span>
                <div className="kpi-label">At-Risk Customers</div>
                <div className="kpi-value" style={{ color: 'var(--danger)' }}>{data.at_risk_customers}</div>
                <div className="kpi-sub">Eligible for winback</div>
              </div>
            </Link>
            <Link href="/campaigns?status=draft" style={{ textDecoration: 'none' }}>
              <div className="kpi-card">
                <span className="kpi-icon">📝</span>
                <div className="kpi-label">Active Campaigns</div>
                <div className="kpi-value" style={{ color: 'var(--warning)' }}>{data.draft_campaigns}</div>
                <div className="kpi-sub">Draft / pending approval</div>
              </div>
            </Link>
            <div className="kpi-card">
              <span className="kpi-icon">🏆</span>
              <div className="kpi-label">Completed Campaigns</div>
              <div className="kpi-value" style={{ color: 'var(--success)' }}>{data.completed_campaigns}</div>
              <div className="kpi-sub">With results</div>
            </div>
            <div className="kpi-card">
              <span className="kpi-icon">🔄</span>
              <div className="kpi-label">Simulated Reactivations</div>
              <div className="kpi-value" style={{ color: 'var(--accent)' }}>{data.total_simulated_reactivations}</div>
              <div className="kpi-sub">Demo estimate</div>
            </div>
            <div className="kpi-card">
              <span className="kpi-icon">💰</span>
              <div className="kpi-label">Est. Incremental Revenue</div>
              <div className="kpi-value" style={{ color: 'var(--success)', fontSize: '1.5rem' }}>
                {formatCurrency(data.total_estimated_revenue_minor)}
              </div>
              <div className="kpi-sub">Simulated — not real revenue</div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Quick Actions
            </h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Link href="/customers?filter=at_risk" className="btn btn-secondary">
                🔍 Find at-risk customers
              </Link>
              <Link href="/campaigns/new" className="btn btn-primary">
                ＋ Create winback campaign
              </Link>
              <Link href="/audit" className="btn btn-secondary">
                📋 View audit log
              </Link>
            </div>
          </div>

          {/* Recent Campaigns */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Recent Campaigns</h2>
              <Link href="/campaigns" style={{ fontSize: '0.8rem', color: 'var(--accent)', textDecoration: 'none' }}>View all →</Link>
            </div>
            {data.recent_campaigns.length === 0 ? (
              <div className="center-content" style={{ padding: '2rem' }}>
                <span className="empty-icon">📣</span>
                <p className="empty-title">No campaigns yet</p>
                <p className="empty-desc">Create your first winback campaign to see results here.</p>
                <Link href="/campaigns/new" className="btn btn-primary">Create Campaign</Link>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th>Channel</th>
                      <th>Language</th>
                      <th>Last Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_campaigns.map((c) => (
                      <tr key={c.id} onClick={() => router.push(`/campaigns/${c.id}`)}>
                        <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.name}</td>
                        <td>
                          <span className={`badge status-${c.status}`}>
                            {STATUS_LABELS[c.status] || c.status}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-muted">{c.channel}</span>
                        </td>
                        <td>
                          <span className="badge badge-info">{c.language.toUpperCase()}</span>
                        </td>
                        <td style={{ fontSize: '0.8rem' }}>{timeAgo(c.updated_at)}</td>
                        <td>
                          <Link href={`/campaigns/${c.id}`} className="btn btn-sm btn-secondary" onClick={e => e.stopPropagation()}>
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
