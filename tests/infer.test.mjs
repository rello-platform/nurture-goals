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
import {
  inferNurtureGoal,
  inferLoanProgram,
  inferNurtureContext,
  isLoanProgram,
  LOAN_PROGRAMS,
  NURTURE_GOALS,
  NURTURE_GOAL_METADATA,
  PRIMING_CATEGORIES_BY_GOAL,
  getRequiredPrimingCategoryKeys,
} from '../dist/index.js';

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

describe('inferNurtureGoal — PFP loan-program routing (pfp_loan_purpose SECONDARY source; 06142026-NURTURE-AUDIT P1)', () => {
  // THE P1 GAP: PFP leads carry their loan program in pfp_loan_purpose
  // (stamped by PathfinderPro custom-field-builder.ts) but goal inference read
  // ONLY hh_intent_type, so every PFP lead collapsed to default HOME_PURCHASE
  // unless HH separately stamped hh_intent_type. v0.5.0 reads pfp_loan_purpose
  // as a SECONDARY source.

  // ── Canonical PFP agency-intake enum forms (what custom-field-builder writes) ──
  it('pfp_loan_purpose PURCHASE → HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'PURCHASE' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose RATE_TERM_REFI → REFINANCE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'RATE_TERM_REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('pfp_loan_purpose CASH_OUT_REFI → EQUITY_ACCESS (equity-tapping framing)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'CASH_OUT_REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'EQUITY_ACCESS');
  });

  // ── Lowercase / hyphen semantic forms (audit vocabulary + other PFP code paths) ──
  it('pfp_loan_purpose "refinance" → REFINANCE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'refinance' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('pfp_loan_purpose "rate-term refi" (hyphen + space) → REFINANCE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'rate-term refi' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('pfp_loan_purpose "cash-out" → EQUITY_ACCESS', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'cash-out' }, entityType: 'LEAD' } }));
    assert.equal(got, 'EQUITY_ACCESS');
  });
  it('pfp_loan_purpose "reverse" / "HECM" → REVERSE_MORTGAGE', () => {
    assert.equal(inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'reverse' }, entityType: 'LEAD' } })), 'REVERSE_MORTGAGE');
    assert.equal(inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'HECM' }, entityType: 'LEAD' } })), 'REVERSE_MORTGAGE');
  });

  // ── DSCR / investor — P3 (INVESTOR goal now exists) → INVESTOR ──
  it('pfp_loan_purpose "DSCR" → INVESTOR (06142026-NURTURE-AUDIT P3)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'DSCR' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('pfp_loan_purpose "investor" → INVESTOR (P3)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'investor' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });

  // ── PRECEDENCE: hh_intent_type WINS over pfp_loan_purpose ──
  it('hh_intent_type=BUY + pfp_loan_purpose=RATE_TERM_REFI → HOME_PURCHASE (HH wins)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'BUY', pfp_loan_purpose: 'RATE_TERM_REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('hh_intent_type=REFI + pfp_loan_purpose=PURCHASE → REFINANCE (HH wins)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'REFI', pfp_loan_purpose: 'PURCHASE' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });
  it('hh_intent_type=SELL + pfp_loan_purpose=CASH_OUT_REFI → HOME_SALE (HH wins; PFP not reached)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'SELL', pfp_loan_purpose: 'CASH_OUT_REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_SALE');
  });
  it('hh_intent_type=UNKNOWN (no HH match) + pfp_loan_purpose=refinance → REFINANCE (PFP fallback fires)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'UNKNOWN', pfp_loan_purpose: 'refinance' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });

  // ── PFP does NOT override post-sale stage when no purpose maps; and DOES
  //    take precedence over stage routing when it maps (mirrors hh_intent_type) ──
  it('CLOSED_WON + pfp_loan_purpose=RATE_TERM_REFI → REFINANCE (program intent fires before stage routing)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: 'CLOSED_WON', metadata: { pfp_loan_purpose: 'RATE_TERM_REFI' }, entityType: 'LEAD' } }));
    assert.equal(got, 'REFINANCE');
  });

  // ── Null / empty / wrong-type safety (CLAUDE.md production checklist) ──
  it('pfp_loan_purpose null → falls through to default HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: null }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose "" (empty) → falls through to default HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: '' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose whitespace-only → falls through to default HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: '   ' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose non-string (number) → falls through to default HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 42 }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose unrecognized garbage → falls through to default HOME_PURCHASE', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { pfp_loan_purpose: 'xyzzy' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose CASH_OUT_REFI but post-sale + reactivation signal — program wins (REACTIVATION not reached)', () => {
    // pfp program intent fires before stage/reactivation routing (parity with hh_intent_type ordering)
    const got = inferNurtureGoal(baseInput({ lead: { stage: 'PAST_CLIENT', metadata: { pfp_loan_purpose: 'CASH_OUT_REFI', hh_rate_drop_signal: true }, entityType: 'LEAD' } }));
    assert.equal(got, 'EQUITY_ACCESS');
  });
});

// =============================================================================
// P3 — INVESTOR goal + loanProgram dimension (06142026-NURTURE-AUDIT P3)
// =============================================================================

describe('P3 — INVESTOR goal routing', () => {
  it('hh_intent_type=INVEST → INVESTOR', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'INVEST' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('hh_intent_type=INVESTOR (alias) → INVESTOR', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'INVESTOR' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('dscr_intent_type=DSCR_INVESTMENT (DSCR advisor marker; no pfp_loan_purpose) → INVESTOR', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { dscr_intent_type: 'DSCR_INVESTMENT' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('dscr_loan_purpose contains "investment" → INVESTOR', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { dscr_loan_purpose: 'DSCR investment property' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('hh_intent_type wins over DSCR signal (HH BUY + dscr marker → HOME_PURCHASE)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { hh_intent_type: 'BUY', dscr_intent_type: 'DSCR_INVESTMENT' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
  it('DSCR program intent fires before post-sale stage routing (PAST_CLIENT + dscr → INVESTOR)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: 'PAST_CLIENT', metadata: { dscr_intent_type: 'DSCR_INVESTMENT' }, entityType: 'LEAD' } }));
    assert.equal(got, 'INVESTOR');
  });
  it('no DSCR/investor signal → unchanged (default HOME_PURCHASE)', () => {
    const got = inferNurtureGoal(baseInput({ lead: { stage: null, metadata: { dscr_intent_type: '' }, entityType: 'LEAD' } }));
    assert.equal(got, 'HOME_PURCHASE');
  });
});

describe('P3 — INVESTOR present in all total goal-keyed maps', () => {
  it('NURTURE_GOALS includes INVESTOR', () => {
    assert.ok(NURTURE_GOALS.includes('INVESTOR'));
  });
  it('NURTURE_GOAL_METADATA has an INVESTOR entry with a non-empty displayName + description', () => {
    const m = NURTURE_GOAL_METADATA.INVESTOR;
    assert.ok(m, 'INVESTOR metadata missing');
    assert.equal(m.key, 'INVESTOR');
    assert.ok(m.displayName.length > 0);
    assert.ok(m.description.length > 0);
  });
  it('PRIMING_CATEGORIES_BY_GOAL has INVESTOR with a required investment_thesis category', () => {
    const cats = PRIMING_CATEGORIES_BY_GOAL.INVESTOR;
    assert.ok(Array.isArray(cats) && cats.length > 0);
    const required = getRequiredPrimingCategoryKeys('INVESTOR');
    assert.ok(required.includes('investment_thesis'));
  });
});

describe('P3 — inferLoanProgram (the loanProgram dimension)', () => {
  // ── VA ──
  it('veteran + refinance phase → VA_IRRRL', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_is_veteran: true, pfp_loan_purpose: 'RATE_TERM_REFI' } }), 'VA_IRRRL');
  });
  it('veteran (string "yes") + HH RATE_WATCH → VA_IRRRL', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_is_veteran: 'yes', hh_intent_type: 'RATE_WATCH' } }), 'VA_IRRRL');
  });
  it('veteran + purchase phase → VA_PURCHASE', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_is_veteran: true, pfp_loan_purpose: 'PURCHASE' } }), 'VA_PURCHASE');
  });
  it('VA in pfp_eligible_programs + unknown phase → VA_PURCHASE (purchase-default)', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'Conventional, FHA, VA' } }), 'VA_PURCHASE');
  });
  // ── FHA ──
  it('FHA eligible + refinance phase → FHA_STREAMLINE', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'FHA', pfp_loan_purpose: 'refinance' } }), 'FHA_STREAMLINE');
  });
  it('FHA eligible + cash-out refi → FHA_CASHOUT', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'FHA', pfp_loan_purpose: 'CASH_OUT_REFI' } }), 'FHA_CASHOUT');
  });
  it('FHA eligible + purchase phase → FHA_PURCHASE', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'FHA', pfp_loan_purpose: 'PURCHASE' } }), 'FHA_PURCHASE');
  });
  it('VA precedes FHA when both eligible + refi → VA_IRRRL', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'FHA, VA', pfp_loan_purpose: 'refinance' } }), 'VA_IRRRL');
  });
  // ── Conventional / DSCR / loanType fallback ──
  it('Conventional only → CONVENTIONAL', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'Conventional' } }), 'CONVENTIONAL');
  });
  it('DSCR signal → DSCR (precedes everything)', () => {
    assert.equal(inferLoanProgram({ metadata: { dscr_intent_type: 'DSCR_INVESTMENT', pfp_eligible_programs: 'Conventional' } }), 'DSCR');
  });
  // ── HH-sourced investor cohort → DSCR (HH-INVESTOR-LOANPROGRAM-SOT, 06172026) ──
  // The dominant production DSCR cohort: HH stamps hh_intent_type='INVESTOR' /
  // hh_non_owner_occupied=true / hh_investor_subtype, NO dscr_*/scout_* markers.
  // These previously returned null (no DSCR hook); now they resolve DSCR via the
  // SHARED inference (mirrors Milo's retired resolveLoanProgram HH fallback).
  it('HH hh_intent_type=INVESTOR → DSCR (was null pre-SOT)', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_intent_type: 'INVESTOR' } }), 'DSCR');
  });
  it('HH hh_intent_type=investor (lowercase) → DSCR (case-insensitive)', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_intent_type: 'investor' } }), 'DSCR');
  });
  it('HH hh_non_owner_occupied=true → DSCR (absentee-owner cohort, e.g. Big Star cmoesbhsl0027mq0fld9z2nnb)', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_non_owner_occupied: true } }), 'DSCR');
  });
  it('HH hh_investor_subtype string → DSCR', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_investor_subtype: 'out_of_state_owner' } }), 'DSCR');
  });
  it('HH-investor DSCR precedes VA (hh_non_owner_occupied + veteran flag → DSCR)', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_non_owner_occupied: true, pfp_is_veteran: true } }), 'DSCR');
  });
  it('HH-investor null-safety: non-string intent / empty subtype / false flag → not DSCR', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_intent_type: 42 } }), null);
    assert.equal(inferLoanProgram({ metadata: { hh_investor_subtype: '   ' } }), null);
    assert.equal(inferLoanProgram({ metadata: { hh_non_owner_occupied: false } }), null);
    // hh_non_owner_occupied as the string 'true' must NOT trigger (strict === true).
    assert.equal(inferLoanProgram({ metadata: { hh_non_owner_occupied: 'true' } }), null);
  });
  it('HH BUY (non-investor) → not DSCR (no false-positive on ordinary HH leads)', () => {
    assert.equal(inferLoanProgram({ metadata: { hh_intent_type: 'BUY' } }), null);
  });
  it('Transaction.loanType fallback (no pfp fields) → program family', () => {
    assert.equal(inferLoanProgram({ metadata: {}, loanType: 'VA' }), 'VA_PURCHASE');
    assert.equal(inferLoanProgram({ metadata: { pfp_loan_purpose: 'refinance' }, loanType: 'FHA' }), 'FHA_STREAMLINE');
  });
  // ── null / garbage safety ──
  it('empty metadata → null (no program, no hook)', () => {
    assert.equal(inferLoanProgram({ metadata: {} }), null);
  });
  it('garbage program list → null', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_eligible_programs: 'xyzzy, frobnicate' } }), null);
  });
  it('non-string veteran/programs → null (never throws)', () => {
    assert.equal(inferLoanProgram({ metadata: { pfp_is_veteran: 42, pfp_eligible_programs: { a: 1 } } }), null);
  });
  it('null metadata → null (never throws)', () => {
    assert.equal(inferLoanProgram({ metadata: null }), null);
  });
  it('isLoanProgram type guard', () => {
    assert.ok(isLoanProgram('VA_IRRRL'));
    assert.ok(!isLoanProgram('NOPE'));
    assert.ok(!isLoanProgram(null));
    // 7 at P3; STEP 2 (06152026) added NON_QM + CONSTRUCTION → 9.
    assert.equal(LOAN_PROGRAMS.length, 9);
  });
});

describe('P3 — inferNurtureContext (goal + loanProgram in one call)', () => {
  it('VA IRRRL refi vet → goal REFINANCE + loanProgram VA_IRRRL', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: '__milo_compose__',
      lead: { stage: null, metadata: { pfp_is_veteran: true, pfp_loan_purpose: 'RATE_TERM_REFI' }, entityType: 'LEAD' },
    }));
    assert.deepEqual(ctx, { goal: 'REFINANCE', loanProgram: 'VA_IRRRL' });
  });
  it('FHA streamline lead → goal REFINANCE + loanProgram FHA_STREAMLINE', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: '__milo_compose__',
      lead: { stage: null, metadata: { pfp_eligible_programs: 'FHA', pfp_loan_purpose: 'refinance' }, entityType: 'LEAD' },
    }));
    assert.deepEqual(ctx, { goal: 'REFINANCE', loanProgram: 'FHA_STREAMLINE' });
  });
  it('DSCR investor → goal INVESTOR + loanProgram DSCR', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: '__milo_compose__',
      lead: { stage: null, metadata: { dscr_intent_type: 'DSCR_INVESTMENT' }, entityType: 'LEAD' },
    }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
  it('plain lead → goal HOME_PURCHASE + loanProgram null (no hook, no behavior change)', () => {
    const ctx = inferNurtureContext(baseInput({ signalType: '__milo_compose__' }));
    assert.deepEqual(ctx, { goal: 'HOME_PURCHASE', loanProgram: null });
  });
  // HH-investor cohort (HH-INVESTOR-LOANPROGRAM-SOT): hh_intent_type=INVESTOR
  // routes BOTH the INVESTOR goal AND the DSCR program; hh_non_owner_occupied
  // alone leaves the goal at its stage/default but still surfaces DSCR.
  it('HH hh_intent_type=INVESTOR → goal INVESTOR + loanProgram DSCR (shared inference)', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: '__milo_compose__',
      lead: { stage: null, metadata: { hh_intent_type: 'INVESTOR' }, entityType: 'LEAD' },
    }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
  it('HH hh_non_owner_occupied=true → goal HOME_PURCHASE + loanProgram DSCR (program rides alongside)', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: '__milo_compose__',
      lead: { stage: null, metadata: { hh_non_owner_occupied: true }, entityType: 'LEAD' },
    }));
    assert.deepEqual(ctx, { goal: 'HOME_PURCHASE', loanProgram: 'DSCR' });
  });
  it('non-goal-shift signal → goal null but loanProgram still computed from lead state', () => {
    const ctx = inferNurtureContext(baseInput({
      signalType: 'newsletter_studio.email_complained',
      lead: { stage: null, metadata: { pfp_eligible_programs: 'FHA', pfp_loan_purpose: 'PURCHASE' }, entityType: 'LEAD' },
    }));
    assert.equal(ctx.goal, null);
    assert.equal(ctx.loanProgram, 'FHA_PURCHASE');
  });
});

// ===========================================================================
// STEP 2 — Home-Scout contact-form (`scout_*`) branching (06152026).
//   Goal routing (inferFromLeadState, TERTIARY source) + program routing
//   (inferLoanProgram). All slug values byte-matched to the HS catalog
//   (~/The-Home-Scout/src/lib/contact-question-catalog.ts @ a08db41).
// ===========================================================================

function scoutLead(scoutMeta) {
  return baseInput({
    signalType: '__milo_compose__',
    lead: { stage: null, metadata: scoutMeta, entityType: 'LEAD' },
  });
}
function scoutProgram(scoutMeta) {
  return inferLoanProgram({ metadata: scoutMeta });
}

describe('STEP 2 — scout NON_QM / bank-statement program', () => {
  it('scout_income_type=self-employed → NON_QM', () => {
    assert.equal(scoutProgram({ scout_income_type: 'self-employed' }), 'NON_QM');
  });
  it('scout_income_type=1099-contractor → NON_QM', () => {
    assert.equal(scoutProgram({ scout_income_type: '1099-contractor' }), 'NON_QM');
  });
  it('scout_income_type=business-owner → NON_QM', () => {
    assert.equal(scoutProgram({ scout_income_type: 'business-owner' }), 'NON_QM');
  });
  it('scout_files_tax_returns=no → NON_QM (even with w-2 income)', () => {
    assert.equal(scoutProgram({ scout_income_type: 'w-2-employee', scout_files_tax_returns: 'no' }), 'NON_QM');
  });
  it('scout_income_type=w-2-employee → NOT NON_QM (standard path → null)', () => {
    assert.equal(scoutProgram({ scout_income_type: 'w-2-employee' }), null);
  });
  it('scout_files_tax_returns=yes alone → NOT NON_QM (null)', () => {
    assert.equal(scoutProgram({ scout_files_tax_returns: 'yes' }), null);
  });
});

describe('STEP 2 — scout DSCR / investor (goal INVESTOR + program DSCR)', () => {
  it('scout_is_investment=yes → goal INVESTOR + program DSCR', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_is_investment: 'yes' }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
  it('scout_rentals_owned=1-3 → goal INVESTOR + program DSCR', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_rentals_owned: '1-3' }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
  it('scout_rentals_owned=4 → goal INVESTOR + program DSCR', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_rentals_owned: '4' }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
  it('scout_rentals_owned=0 → NOT investor (null program, HOME_PURCHASE goal)', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_rentals_owned: '0' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
    assert.equal(ctx.loanProgram, null);
  });
  it('self-employed INVESTOR → DSCR (not NON_QM — DSCR is more specific)', () => {
    assert.equal(scoutProgram({ scout_income_type: 'self-employed', scout_is_investment: 'yes' }), 'DSCR');
  });
  it('scout_occupancy=investment → goal INVESTOR + program DSCR', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_occupancy: 'investment' }));
    assert.deepEqual(ctx, { goal: 'INVESTOR', loanProgram: 'DSCR' });
  });
});

describe('STEP 2 — scout VA program (scout_va_eligible)', () => {
  it('scout_va_eligible=yes (purchase phase) → VA_PURCHASE', () => {
    assert.equal(scoutProgram({ scout_va_eligible: 'yes' }), 'VA_PURCHASE');
  });
  it('scout_va_eligible=yes + refinance → VA_IRRRL', () => {
    assert.equal(scoutProgram({ scout_va_eligible: 'yes', scout_loan_purpose: 'refinance' }), 'VA_IRRRL');
  });
  it('scout_va_eligible=no → not VA (null)', () => {
    assert.equal(scoutProgram({ scout_va_eligible: 'no' }), null);
  });
});

describe('STEP 2 — scout CONSTRUCTION program', () => {
  it('scout_construction_type=building → CONSTRUCTION', () => {
    assert.equal(scoutProgram({ scout_construction_type: 'building' }), 'CONSTRUCTION');
  });
  it('scout_construction_type=renovating → CONSTRUCTION', () => {
    assert.equal(scoutProgram({ scout_construction_type: 'renovating' }), 'CONSTRUCTION');
  });
  it('scout_construction_type=buying → NOT construction (null — ordinary purchase)', () => {
    assert.equal(scoutProgram({ scout_construction_type: 'buying' }), null);
  });
});

describe('STEP 2 — scout refinance goal routing', () => {
  it('scout_loan_purpose=refinance → REFINANCE goal', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_loan_purpose: 'refinance' }));
    assert.equal(ctx.goal, 'REFINANCE');
  });
  it('scout_refi_goal=lower-payment → REFINANCE goal', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_refi_goal: 'lower-payment' }));
    assert.equal(ctx.goal, 'REFINANCE');
  });
  it('scout_refi_goal=cash-out → EQUITY_ACCESS goal (mirrors P1 cash-out map)', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_refi_goal: 'cash-out' }));
    assert.equal(ctx.goal, 'EQUITY_ACCESS');
  });
});

describe('STEP 2 — scout FHA / first-time / DPA education', () => {
  it('scout_first_time_buyer=yes → FHA_PURCHASE', () => {
    assert.equal(scoutProgram({ scout_first_time_buyer: 'yes' }), 'FHA_PURCHASE');
  });
  it('scout_down_payment=none-yet → FHA_PURCHASE', () => {
    assert.equal(scoutProgram({ scout_down_payment: 'none-yet' }), 'FHA_PURCHASE');
  });
  it('scout_down_payment=under-5 → FHA_PURCHASE', () => {
    assert.equal(scoutProgram({ scout_down_payment: 'under-5' }), 'FHA_PURCHASE');
  });
  it('scout_down_payment=20-plus → NOT FHA-leaning (null)', () => {
    assert.equal(scoutProgram({ scout_down_payment: '20-plus' }), null);
  });
});

describe('STEP 2 — scout RE-hat buyer/seller goal routing', () => {
  it('scout_buy_sell=buying → HOME_PURCHASE goal', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_buy_sell: 'buying' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
  });
  it('scout_buy_sell=selling → HOME_SALE goal', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_buy_sell: 'selling' }));
    assert.equal(ctx.goal, 'HOME_SALE');
  });
  it('scout_buy_sell=both → HOME_PURCHASE goal (buyer-flavor)', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_buy_sell: 'both' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
  });
});

describe('STEP 2 — compliance hold (scout_age_62_plus) is EXCLUDED / DORMANT', () => {
  it('scout_age_62_plus=yes does NOT change goal (stays HOME_PURCHASE default)', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_age_62_plus: 'yes' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
    assert.equal(ctx.loanProgram, null);
  });
  it('scout_age_62_plus does NOT produce any loan program', () => {
    assert.equal(scoutProgram({ scout_age_62_plus: 'yes' }), null);
  });
  it('scout_age_62_plus alongside a real signal does not alter that signal', () => {
    // A VA-eligible 62+ lead is routed purely by VA — the age key is inert.
    assert.equal(scoutProgram({ scout_age_62_plus: 'yes', scout_va_eligible: 'yes' }), 'VA_PURCHASE');
  });
});

describe('STEP 2 — precedence: hh_* and pfp_*/dscr_* win over scout_*', () => {
  it('hh_intent_type=BUY beats scout investor signal (goal HOME_PURCHASE)', () => {
    const ctx = inferNurtureContext(scoutLead({ hh_intent_type: 'BUY', scout_is_investment: 'yes' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
  });
  it('pfp_loan_purpose=PURCHASE beats scout refinance signal (goal HOME_PURCHASE)', () => {
    const ctx = inferNurtureContext(scoutLead({ pfp_loan_purpose: 'PURCHASE', scout_loan_purpose: 'refinance' }));
    assert.equal(ctx.goal, 'HOME_PURCHASE');
  });
  it('pfp veteran flag program (VA_PURCHASE) still wins for program dimension', () => {
    // pfp veteran → VA_PURCHASE even if scout says self-employed (NON_QM).
    assert.equal(scoutProgram({ pfp_is_veteran: true, scout_income_type: 'self-employed' }), 'VA_PURCHASE');
  });
});

describe('STEP 2 — LOAN_PROGRAMS union grew by NON_QM + CONSTRUCTION', () => {
  it('LOAN_PROGRAMS now has 9 members incl. NON_QM + CONSTRUCTION', () => {
    assert.equal(LOAN_PROGRAMS.length, 9);
    assert.ok(LOAN_PROGRAMS.includes('NON_QM'));
    assert.ok(LOAN_PROGRAMS.includes('CONSTRUCTION'));
    assert.ok(isLoanProgram('NON_QM'));
    assert.ok(isLoanProgram('CONSTRUCTION'));
  });
});

describe('STEP 2 — empty/null-safe (no scout fields → byte-identical behavior)', () => {
  it('plain lead with no scout fields → HOME_PURCHASE + null program', () => {
    const ctx = inferNurtureContext(scoutLead({}));
    assert.deepEqual(ctx, { goal: 'HOME_PURCHASE', loanProgram: null });
  });
  it('scout fields present but all empty strings → no branch fires', () => {
    const ctx = inferNurtureContext(scoutLead({ scout_income_type: '', scout_buy_sell: '', scout_loan_purpose: '' }));
    assert.deepEqual(ctx, { goal: 'HOME_PURCHASE', loanProgram: null });
  });
});
