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

describe('inferNurtureGoal — registry-driven non-goal-shift gate (Wave B; null returns)', () => {
  // THE LIVE BUG (DISCOVERED-NURTURE-GOAL-INFER-IGNORES-SPOKE-PREFIXED-SIGNAL-
  // TYPES-260521): Newsletter-Studio emits email_* BARE; Rello's
  // /api/signals/batch namespace-prefixes them to `newsletter_studio.email_*`,
  // which the pre-Wave-B bare-name exclusion set never matched → fell through to
  // HOME_PURCHASE → spurious blocked_no_matching_campaign rows. The registry-
  // driven gate (`isGoalShiftSignal` normalizes internally + consults the
  // registry, where NS email lifecycle is `goalShiftSemantics:false`) closes it.
  it('returns null for newsletter_studio.email_complained — THE bug form (receiver-prefixed)', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'newsletter_studio.email_complained' })), null);
  });
  it('returns null for newsletter_studio.email_unsubscribed + email_bounced', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'newsletter_studio.email_unsubscribed' })), null);
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'newsletter_studio.email_bounced' })), null);
  });
  it('returns null for the canonical hyphen form too (newsletter-studio.email_complained)', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'newsletter-studio.email_complained' })), null);
  });
  it('returns null for PFP bare compliance.config_changed (alias-folded → registered pathfinder-pro.compliance.config_changed)', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'compliance.config_changed' })), null);
  });
  it('returns null for canonical pathfinder-pro.compliance.gate_blocked', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'pathfinder-pro.compliance.gate_blocked' })), null);
  });
});

describe('inferNurtureGoal — fail-open for deferred / unregistered forms (Wave B; deliberate SPEC behavior)', () => {
  // Wave B narrows the gate from the pre-Wave-B "bare names + 3 prefixes
  // regardless of emitter" to "registered canonical forms". The forms below
  // were in the old local exclusion set but (a) have NO live emitter reaching
  // the connector (verified — appraisal_concern / agent_action.* / deal_distress.*
  // are emitted nowhere; bare email_* always arrives receiver-prefixed) and
  // (b) cannot be canonicalized without a slug owner — deferred to Wave C/D
  // (DISCOVERED filed). Fail-open is the deliberate gate semantics (SPEC §8
  // decision 9): an unregistered/unnormalizable type proceeds to lead-state
  // inference rather than being silently suppressed.
  it('bare appraisal_concern (no slug owner, no live emitter) → fail-open → lead-state goal', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'appraisal_concern' })), 'HOME_PURCHASE');
  });
  it('bare email_complained (un-prefixed; production path always prefixes via the receiver) → fail-open', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'email_complained' })), 'HOME_PURCHASE');
  });
  it('agent_action.* / deal_distress.* (no live emitter; deferred Wave C/D) → fail-open', () => {
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'agent_action.task_completed' })), 'HOME_PURCHASE');
    assert.equal(inferNurtureGoal(baseInput({ signalType: 'deal_distress.appraisal_low' })), 'HOME_PURCHASE');
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
