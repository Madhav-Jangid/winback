'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ScrollText } from 'lucide-react';

interface AuditEventRow {
  id: string;
  created_at: string;
  actor_type: string;
  event_type: string;
  entity_type: string;
  campaign_name: string | null;
  metadata: Record<string, unknown>;
}

interface AuditResponse {
  events: AuditEventRow[];
  total: number;
  page: number;
  limit: number;
}

interface CampaignOption {
  id: string;
  name: string;
}

interface AuditTableProps {
  campaigns: CampaignOption[];
  eventTypes: readonly string[];
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeText(event: AuditEventRow): string {
  const metadata = event.metadata;
  const detail = metadata.reason ?? metadata.failure_code ?? metadata.status;
  if (typeof detail === 'string') return titleCase(detail);
  if (typeof metadata.delivered === 'number' || typeof metadata.failed === 'number') {
    const delivered = typeof metadata.delivered === 'number' ? metadata.delivered : 0;
    const failed = typeof metadata.failed === 'number' ? metadata.failed : 0;
    return `${delivered} delivered · ${failed} failed`;
  }
  if (metadata.simulated === true) return 'Simulation recorded';
  return 'Recorded';
}

export default function AuditTable({ campaigns, eventTypes }: AuditTableProps) {
  const [campaignId, setCampaignId] = useState('');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const search = new URLSearchParams({ page: String(page), limit: '25' });
    if (campaignId) search.set('campaign_id', campaignId);
    if (eventType) search.set('event_type', eventType);
    try {
      const response = await fetch(`/api/audit?${search.toString()}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not load the audit log.');
      setData(body as AuditResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the audit log.');
    } finally {
      setLoading(false);
    }
  }, [campaignId, eventType, page]);

  useEffect(() => {
    const request = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(request);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));

  return (
    <section aria-label="Audit events">
      <div className="audit-filters">
        <label className="form-group">
          <span className="form-label">Campaign</span>
          <select
            className="form-select"
            value={campaignId}
            onChange={(event) => { setCampaignId(event.target.value); setPage(1); }}
          >
            <option value="">All campaigns</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Action</span>
          <select
            className="form-select"
            value={eventType}
            onChange={(event) => { setEventType(event.target.value); setPage(1); }}
          >
            <option value="">All actions</option>
            {eventTypes.map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary audit-refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="error-box" role="alert">
          <div>
            <strong>Could not load the audit log</strong>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>Try again</button>
          </div>
        </div>
      )}

      {loading && !data && <div className="center-content" role="status"><div className="loading-spinner" /><p>Loading audit events…</p></div>}

      {!error && data && data.events.length === 0 && (
        <div className="card audit-empty">
          <ScrollText size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2>No events match these filters</h2>
          <p>Workflow actions will appear here as they are recorded.</p>
        </div>
      )}

      {!error && data && data.events.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="audit-table">
              <caption className="sr-only">Audit events, newest first. Personal message content is not included.</caption>
              <thead>
                <tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Campaign</th><th scope="col">Result</th></tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id}>
                    <td><time dateTime={event.created_at}>{new Intl.DateTimeFormat('en-IN', {
                      dateStyle: 'medium', timeStyle: 'short',
                    }).format(new Date(event.created_at))}</time></td>
                    <td>{titleCase(event.actor_type)}</td>
                    <td><span className="audit-action">{titleCase(event.event_type)}</span></td>
                    <td>{titleCase(event.entity_type)}</td>
                    <td>{event.campaign_name ?? '—'}</td>
                    <td>{outcomeText(event)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="audit-pagination" aria-label="Audit pagination">
            <span className="form-help">
              {data.total === 0 ? 'No events' : `${(page - 1) * 25 + 1}–${Math.min(page * 25, data.total)} of ${data.total} events`}
            </span>
            <div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Previous page"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              ><ChevronLeft size={16} aria-hidden="true" />Previous</button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-label="Next page"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages || loading}
              >Next<ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
