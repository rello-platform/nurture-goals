/**
 * inferNurtureGoal — branch-coverage tests.
 *
 * Test surface per NURTURE-PRECEDENCE-AUTHORITY-SPEC-260520 Wave 1 dispatch:
 * - Every PRIORITY_OVERRIDES goal-shift-bearing signalType reaches lead-state inference.
 * - Every NurtureGoal output is reachable from lead-state inference.
 * - Explicit null cases for non-goal-shift signals (appraisal_concern,
 *   email_complained, agent-action prefix, deal-distress prefix,
 *   compliance prefix).
 *
 * Byte-identical-behavior guarantee for Milo wrapper: lead-state inference
 * (passed any non-blocked signalType) must produce the same NurtureGoal that
 * Milo's `resolveNurtureGoalRaw` would have produced for the same lead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNurtureGoal } from '../dist/index.js';

function baseInput(overrides = {}) {
  return {
    signalType: 'rate.drop_detected',
    signalPayload: {},
    lead: {
      stage: null,
      metadata: {},
      entityType: 'LEAD',
    },
    ...overrides,
  };
}

describe('inferNurtureGoal — non-goal-shift signal filter (null returns)', () => {
  it('returns null for appraisal_concern signal', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'appraisal_concern' })), null);
  });
  it('returns null for email_complained signal', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'email_complained' })), null);
  });
  it('returns null for email_unsubscribed signal', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'email_unsubscribed' })), null);
  });
  it('returns null for email_bounced signal', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'email_bounced' })), null);
  });
  it('returns null for agent_action.* signal prefix', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'agent_action.task_completed' })), null);
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'agent_action.note_added' })), null);
  });
  it('returns null for deal_distress.* signal prefix', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'deal_distress.appraisal_low' })), null);
  });
  it('returns null for compliance.* signal prefix', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'compliance.consent_revoked' })), null);
  });
});

describe('inferNurtureGoal — HH intent-type routing (every intent → expected goal)', () => {
  it('REFI intent → REFINANCE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('REFINANCE intent → REFINANCE (alias)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'REFINANCE' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('RATE_WATCH intent → REFINANCE (rate-sensitive, same framework cascade)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'RATE_WATCH' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('REVERSE_MORTGAGE intent → REVERSE_MORTGAGE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'REVERSE_MORTGAGE' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REVERSE_MORTGAGE');
  });
  it('EQUITY_ACCESS intent → EQUITY_ACCESS', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'EQUITY_ACCESS' }, entityType: 'LEAD' } }));
    assert.equal(got, 'EQUITY_ACCESS');
  });
  it('SELL intent → HOME_SALE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'SELL' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_SALE');
  });
  it('FSBO intent → LISTING_CONVERSION', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'FSBO' }, entityType: 'LEAD' } }));
    assert.equal(got, 'LISTING_CONVERSION');
  });
  it('EXPIRED_LISTING intent → LISTING_CONVERSION', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'EXPIRED_LISTING' }, entityType: 'LEAD' } }));
    assert.equal(got, 'LISTING_CONVERSION');
  });
  it('BUY intent → HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'BUY' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('Intent type is case-insensitive (upper-cased before match)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'refi' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('Unknown intent type falls through to default HOME_PURCHASE (no stage match)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'UNKNOWN' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
});

describe('inferNurtureGoal — engagement-conditional branches', () => {
  it('COLD + low engagement → BRAND_AWARENESS (engagement context provided)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: null, metadata: { hh_temperature: 'COLD' }, entityType: 'LEAD' },
        engagement: { recentMessages: [{ opened: false }, { opened: false }, { opened: false }] },
      }),
    );
    assert.equal(got, 'BRAND_AWARENESS');
  });
  it('COLD + low engagement WITHOUT engagement context → default HOME_PURCHASE (no fall-through fire)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_temperature: 'COLD' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('COLD + zero messages = low-engagement (treated as low)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: null, metadata: { hh_temperature: 'COLD' }, entityType: 'LEAD' },
        engagement: { recentMessages: [] },
      }),
    );
    assert.equal(got, 'BRAND_AWARENESS');
  });
  it('COLD + high engagement (>=15% opened) → not BRAND_AWARENESS (falls through)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: null, metadata: { hh_temperature: 'COLD' }, entityType: 'LEAD' },
        engagement: {
          recentMessages: [
            { opened: true },
            { opened: true },
            { opened: false },
            { opened: false },
            { opened: false },
          ],
        },
      }),
    );
    assert.equal(got, 'HOME_PURCHASE');
  });
});

describe('inferNurtureGoal — post-sale routing', () => {
  it('CLOSED_WON + rate-drop signal → REACTIVATION', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED_WON', metadata: { hh_rate_drop_signal: true }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'REACTIVATION');
  });
  it('PAST_CLIENT + life-event signal → REACTIVATION', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'PAST_CLIENT', metadata: { life_event_detected: true }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'REACTIVATION');
  });
  it('CLIENT + hh_lien1_rate above 6.0 → REACTIVATION (high-rate reactivation)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLIENT', metadata: { hh_lien1_rate: 7.1 }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'REACTIVATION');
  });
  it('CLOSED + closedAt 100 days ago + high-engagement → REFERRAL', () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED', metadata: { closedAt: old }, entityType: 'LEAD' },
        engagement: { recentMessages: [{ opened: true }, { opened: true }, { opened: true }] },
      }),
    );
    assert.equal(got, 'REFERRAL');
  });
  it('CLOSED + closedAt 100 days ago WITHOUT engagement context → RELATIONSHIP (default post-sale)', () => {
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED', metadata: { closedAt: old }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'RELATIONSHIP');
  });
  it('CLIENT + no reactivation signals → RELATIONSHIP (default post-sale)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLIENT', metadata: {}, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'RELATIONSHIP');
  });
  it('Stage matching is case-insensitive (lowercase "client" maps to CLIENT)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'client', metadata: {}, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'RELATIONSHIP');
  });
});

describe('inferNurtureGoal — default fallthrough', () => {
  it('Empty lead state (no intent, no stage, no metadata) → HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput());
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('Lead with arbitrary non-matching stage → HOME_PURCHASE', () => {
    const got = inferNurtureGoal(
      baseInput({ lead: { stage: 'NEW_LEAD', metadata: {}, entityType: 'LEAD' } }),
    );
    assert.equal(got, 'HOME_PURCHASE');
  });
});

describe('inferNurtureGoal — Milo-compose-time bypass pattern', () => {
  it('Internal __milo_compose__ signalType bypasses non-goal-shift filter and runs lead-state inference', () => {
    const got = inferNurtureGoal(
      baseInput({
        signalType: '__milo_compose__',
        lead: { stage: null, metadata: { hh_intent_type: 'BUY' }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('Unknown signalType (any non-blocked string) runs lead-state inference', () => {
    const got = inferNurtureGoal(
      baseInput({
        signalType: 'completely_made_up_signal_type',
        lead: { stage: null, metadata: { hh_intent_type: 'SELL' }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'HOME_SALE');
  });
});

describe('inferNurtureGoal — invalid date handling', () => {
  it('closedAt = malformed string → daysSinceClose 0 → not REFERRAL path', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED', metadata: { closedAt: 'not-a-date' }, entityType: 'LEAD' },
        engagement: { recentMessages: [{ opened: true }, { opened: true }] },
      }),
    );
    assert.equal(got, 'RELATIONSHIP');
  });
  it('closedAt = undefined → daysSinceClose 0 → not REFERRAL path', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED', metadata: {}, entityType: 'LEAD' },
        engagement: { recentMessages: [{ opened: true }, { opened: true }] },
      }),
    );
    assert.equal(got, 'RELATIONSHIP');
  });
});

describe('inferNurtureGoal — priority: intent type fires before stage routing', () => {
  it('CLOSED_WON lead with REFI intent → REFINANCE (intent wins; not post-sale RELATIONSHIP)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'CLOSED_WON', metadata: { hh_intent_type: 'REFI' }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'REFINANCE');
  });
  it('PAST_CLIENT with rate_drop_signal AND REFI intent → REFINANCE (intent wins)', () => {
    const got = inferNurtureGoal(
      baseInput({
        lead: { stage: 'PAST_CLIENT', metadata: { hh_intent_type: 'REFI', hh_rate_drop_signal: true }, entityType: 'LEAD' },
      }),
    );
    assert.equal(got, 'REFINANCE');
  });
});
