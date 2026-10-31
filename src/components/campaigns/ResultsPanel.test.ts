import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignResults } from '@/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const panel = await import('./ResultsPanel');

const results: CampaignResults & { campaign_name: string; campaign_status: 'completed' } = {
  campaign_id: 'campaign',
  campaign_name: 'October winback',
  campaign_status: 'completed',
  treatment_count: 10,
  control_count: 5,
  treatment_reactivations: 3,
  control_reactivations: 1,
  treatment_reactivation_rate: 0.3,
  control_reactivation_rate: 0.2,
  incremental_reactivation_rate: 0.1,
  estimated_incremental_reactivations: 1,
  estimated_incremental_revenue_minor: 25_000,
  campaign_cost_minor: 1_500,
  cost_per_reactivated_minor: 500,
  unsubscribe_count: 1,
  unsubscribe_denominator: 10,
  unsubscribe_rate: 0.1,
  average_order_value_minor: 25_000,
  is_simulated: true,
};

describe('results panel', () => {
  it('ME-10: prominently labels simulated results as illustrative, not evidence of real-world lift', () => {
    const markup = renderToStaticMarkup(createElement(panel.default, {
      campaignId: 'campaign',
      campaignStatus: 'completed',
      initialResults: results,
    }));
    expect(markup).toContain('Illustrative simulation — not evidence of real-world lift.');
    expect(markup).toContain('do not represent observed customer behavior');
    expect(markup).toContain('Intent-to-treat denominators');
  });

  it('renders a generation action only after the send has completed', () => {
    const markup = renderToStaticMarkup(createElement(panel.default, {
      campaignId: 'campaign',
      campaignStatus: 'sent',
      initialResults: null,
    }));
    expect(markup).toContain('Simulate outcomes');
    expect(markup).toContain('Ready to measure the campaign');
  });

  it('explains why an outcome run cannot start before the send is finished', () => {
    const markup = renderToStaticMarkup(createElement(panel.default, {
      campaignId: 'campaign',
      campaignStatus: 'approved',
      initialResults: null,
    }));
    expect(markup).toContain('A completed send is required');
    expect(markup).not.toContain('Simulate outcomes</button>');
  });
});
