/**
 * inferNurtureGoal — canonical lead-state goal inference for the Rello platform.
 *
 * Single source of truth for "given this lead's HH signals + stage + engagement,
 * what NurtureGoal should drive its next nurture decision?" Consumed by:
 *
 * - Milo Engine's `resolveNurtureGoal` wrapper (`src/lib/nurture-goals.ts`) —
 *   compose-time goal inference. Milo's wrapper preserves the REALTOR_PROSPECT
 *   short-circuit and the role-narrowing fallback (NA-091); inferNurtureGoal
 *   covers only the borrower-shape inference logic.
 *
 * - Rello's signal-driven precedence-authority connector
 *   (`src/lib/campaigns/enroll-eligible-campaigns.ts`, Wave 2) — on goal-shift-
 *   bearing signal arrival, infers which NurtureGoal the signal points the lead
 *   toward, so the connector can compare against the lead's active campaign.
 *
 * Returns `NurtureGoal | null`:
 * - `NurtureGoal` — the lead's goal under current state.
 * - `null` — the signal is structurally non-goal-shift (e.g., `appraisal_concern`,
 *   `email_complained`, agent-action signals, deal-distress signals, compliance
 *   failures). Connector callers early-return without writing audit rows.
 *
 * Provenance:
 * - Logic ported verbatim from Milo Engine's
 *   `~/Milo-Engine/src/lib/nurture-goals.ts::resolveNurtureGoalRaw @ f79d8cc`
 *   (lines 202-280). REALTOR_PROSPECT short-circuit deliberately omitted —
 *   Milo's outer wrapper applies it before calling here.
 * - Spec: `NURTURE-PRECEDENCE-AUTHORITY-SPEC-260520.md` Hole 1 amendment
 *   (lines 28-58) + DECISIONS-260519.md D2-CORRECTED.
 */

import { isGoalShiftSignal } from '@rello-platform/signals';

import { type NurtureGoal } from './index';

export interface NurtureGoalInferenceInput {
  /**
   * Source signalType the inference is being driven by. Used to short-circuit
   * non-goal-shift signals to `null`. Pass any non-blocked string (e.g.,
   * `'__milo_compose__'`) from compose-time Milo wrapper to bypass the
   * signal-filter and run lead-state inference unconditionally.
   */
  signalType: string;

  /**
   * Signal payload (currently unused by v0.3.0 inference; reserved for
   * future signal-aware inference paths).
   */
  signalPayload: Record<string, unknown>;

  lead: {
    /** Lead stage string (e.g., `'CLOSED_WON'`, `'CLIENT'`, `'PAST_CLIENT'`). */
    stage: string | null;
    /**
     * Lead.customFields / metadata blob. Reads `hh_intent_type`,
     * `hh_temperature`, `closedAt`, `hh_rate_drop_signal`, `life_event_detected`,
     * `hh_lien1_rate`, and — as a SECONDARY source when `hh_intent_type` is
     * absent — `pfp_loan_purpose` (PathfinderPro loan-program vocabulary).
     * Tolerates missing fields.
     */
    metadata: Record<string, unknown>;
    /** Discriminator — REALTOR_PROSPECT short-circuit lives in Milo wrapper. */
    entityType: 'LEAD' | 'REALTOR_PROSPECT';
  };

  /**
   * Optional engagement context. When present, drives the COLD →
   * BRAND_AWARENESS and post-sale +90d → REFERRAL conditional branches.
   * When absent (typical for signal-connector callers), those branches
   * fall through silently — caller receives the next-most-specific goal.
   */
  engagement?: {
    /**
     * Recent outbound messages. Only the boolean `opened` flag is read;
     * low-engagement = opened-rate < 15% (or zero messages).
     */
    recentMessages: ReadonlyArray<{ opened: boolean }>;
  };
}

// The non-goal-shift gate is now registry-driven via
// `@rello-platform/signals::isGoalShiftSignal` (Signal-Type Registry Wave B).
// The former local `NON_GOAL_SHIFT_SIGNAL_TYPES` set + `NON_GOAL_SHIFT_SIGNAL_
// PREFIXES` + `isNonGoalShiftSignal` were removed: they matched BARE names
// (`email_complained`, `appraisal_concern`) and three dotted prefixes
// (`agent_action.`/`deal_distress.`/`compliance.`) but NOT the receiver-
// prefixed production form (`newsletter_studio.email_complained`), so those
// fell through to lead-state inference → HOME_PURCHASE → a spurious
// `blocked_no_matching_campaign` audit row. `isGoalShiftSignal` normalizes the
// raw type internally (folding the underscore-slug prefix to canonical hyphen)
// and consults the registry, where the Newsletter-Studio email lifecycle is
// registered `goalShiftSemantics:false`. See SPEC §4 + §8 decision 9 and
// DISCOVERED-NURTURE-GOAL-INFER-IGNORES-SPOKE-PREFIXED-SIGNAL-TYPES-260521.

/**
 * Port of `resolveNurtureGoalRaw` lead-state inference logic
 * (`~/Milo-Engine/src/lib/nurture-goals.ts:202-280 @ f79d8cc`), abstracted
 * from `MiloContext` to `NurtureGoalInferenceInput`. The REALTOR_PROSPECT
 * short-circuit deliberately stays in Milo's outer wrapper (per spec
 * line 57 — "preserving role-narrowing + REALTOR_PROSPECT short-circuit").
 */
function inferFromLeadState(
  lead: NurtureGoalInferenceInput['lead'],
  engagement?: NurtureGoalInferenceInput['engagement'],
): NurtureGoal {
  const meta = lead.metadata || {};

  // -- Harvest Home intent-based routing --
  // HH's complete intent type set (from scoring-service.ts:detectIntentType):
  //   REFI, RATE_WATCH, REVERSE_MORTGAGE, EQUITY_ACCESS, BUY, SELL,
  //   EXPIRED_LISTING, FSBO, INVEST, RENT, UNKNOWN.
  //
  // REVERSE_MORTGAGE and EQUITY_ACCESS must be detected here so their goal-
  // specific rule paths fire in Milo's frameworks.ts:selectByRules. Without
  // this routing, both intent types fall through to HOME_PURCHASE and inherit
  // the high-score → SCARCITY_REAL rule (wrong framing for retirement-age
  // equity-anchored leads).
  const hhIntentType = ((meta.hh_intent_type as string) || '').toUpperCase();
  const hhTemperature = ((meta.hh_temperature as string) || '').toUpperCase();

  if (hhIntentType === 'REFI' || hhIntentType === 'REFINANCE') {
    return 'REFINANCE';
  }
  // RATE_WATCH = rate gap exists but below actionable threshold. Same goal as
  // REFINANCE so the framework cascade + outcome weights match.
  if (hhIntentType === 'RATE_WATCH') {
    return 'REFINANCE';
  }
  if (hhIntentType === 'REVERSE_MORTGAGE') {
    return 'REVERSE_MORTGAGE';
  }
  if (hhIntentType === 'EQUITY_ACCESS') {
    return 'EQUITY_ACCESS';
  }
  if (hhIntentType === 'SELL') {
    return 'HOME_SALE';
  }
  if (hhIntentType === 'FSBO' || hhIntentType === 'EXPIRED_LISTING') {
    return 'LISTING_CONVERSION';
  }
  if (hhIntentType === 'BUY') {
    return 'HOME_PURCHASE';
  }

  // -- PathfinderPro loan-program routing (SECONDARY source) --
  // `hh_intent_type` (above) WINS when present. Only when HH stamped no
  // intent do we fall back to PFP's `pfp_loan_purpose` (synced by
  // PathfinderPro's custom-field-builder.ts `["pfp_loan_purpose","loanPurpose"]`).
  // Without this, every PFP lead (refi, cash-out, etc.) that HH did not also
  // enrich collapses to the default HOME_PURCHASE below — a generic-buyer
  // mis-framing. Provenance: 06142026-NURTURE-AUDIT P1 (§2.3, §5).
  //
  // `mapPfpLoanPurposeToGoal` returns a NurtureGoal or null; null means the
  // value was empty/unrecognized → fall through to the existing cold/post-sale/
  // default cascade (NO override of HH-derived behavior, NO new fail mode).
  // NOTE (audit P1 / DISCOVERED-NURTURE-PFP-DSCR-INVESTOR-GOAL-061426):
  // DSCR / investor leads are intentionally LEFT at HOME_PURCHASE here — a
  // dedicated INVESTOR NurtureGoal is P3 scope (a new enum member is out of
  // scope for this fix). DSCR also stamps `dscr_loan_purpose`, not
  // `pfp_loan_purpose`, so it does not even reach this branch today.
  const pfpGoal = mapPfpLoanPurposeToGoal(meta.pfp_loan_purpose);
  if (pfpGoal !== null) {
    return pfpGoal;
  }

  // Cold HH lead with no engagement → brand awareness (engagement-conditional;
  // callers without engagement context fall through to post-sale / default).
  if (hhTemperature === 'COLD' && engagement && isLowEngagement(engagement)) {
    return 'BRAND_AWARENESS';
  }

  // -- Post-sale routing --
  const stage = (lead.stage || '').toUpperCase();
  const isPostSale =
    stage === 'CLOSED' ||
    stage === 'WON' ||
    stage === 'CLOSED_WON' ||
    stage === 'CLIENT' ||
    stage === 'PAST_CLIENT';

  if (isPostSale) {
    if (hasReactivationSignal(meta)) {
      return 'REACTIVATION';
    }
    // High engagement + 90+ days since close → referral cultivation.
    // Engagement-conditional; absent engagement falls through to RELATIONSHIP.
    const daysSinceClose = getDaysSince(meta.closedAt as string | undefined);
    if (daysSinceClose >= 90 && engagement && !isLowEngagement(engagement)) {
      return 'REFERRAL';
    }
    return 'RELATIONSHIP';
  }

  // Default
  return 'HOME_PURCHASE';
}

/**
 * Map a PathfinderPro `pfp_loan_purpose` value to a NurtureGoal, mirroring the
 * structure of the `hh_intent_type` table in `inferFromLeadState`.
 *
 * SECONDARY source: `hh_intent_type` takes precedence at the call site — this
 * runs ONLY when HH stamped no intent.
 *
 * Maps to EXISTING NurtureGoal enum members only (no new members — INVESTOR is
 * P3 scope, see DISCOVERED-NURTURE-PFP-DSCR-INVESTOR-GOAL-061426):
 *   purchase            → HOME_PURCHASE
 *   refinance / rate-term refi → REFINANCE
 *   cash-out refi       → EQUITY_ACCESS   (audit P1 §5 line 123)
 *   reverse / HECM      → REVERSE_MORTGAGE
 *   DSCR / investor     → null (caller leaves HOME_PURCHASE; P3)
 *
 * Accepts BOTH the canonical PFP agency-intake enum form
 * (`PURCHASE` / `RATE_TERM_REFI` / `CASH_OUT_REFI`, written by
 * custom-field-builder.ts) AND the lowercase semantic forms used elsewhere in
 * the PFP codebase (`purchase` / `refinance` / `cash_out_refinance` / `reverse`)
 * so a future producer change can't silently regress this mapping.
 *
 * Production-safe: tolerates `null`, `undefined`, non-string (returns null),
 * empty/whitespace-only string (returns null), and is case/separator-insensitive
 * (normalizes `-`, ` `, and `_` to a single canonical token).
 *
 * Returns `NurtureGoal` for a recognized purpose, or `null` for empty / wrong-type
 * / unrecognized / DSCR-investor — callers fall through to the existing cascade.
 */
function mapPfpLoanPurposeToGoal(raw: unknown): NurtureGoal | null {
  if (typeof raw !== 'string') return null;
  // Collapse case + any of `-`, ` `, `_` runs to a single underscore so
  // `RATE_TERM_REFI`, `rate-term refi`, and `rate term refi` all normalize alike.
  const norm = raw.trim().toLowerCase().replace(/[\s_-]+/g, '_');
  if (norm === '') return null;

  switch (norm) {
    case 'purchase':
      return 'HOME_PURCHASE';

    // Rate/term refinance and plain refinance → REFINANCE.
    case 'refinance':
    case 'refi':
    case 'rate_term_refi':
    case 'rate_term_refinance':
    case 'rate_term':
      return 'REFINANCE';

    // Cash-out refinance → EQUITY_ACCESS (equity-tapping framing, per audit P1).
    case 'cash_out_refi':
    case 'cash_out_refinance':
    case 'cash_out':
    case 'cashout':
      return 'EQUITY_ACCESS';

    // Reverse mortgage / HECM → REVERSE_MORTGAGE. (HECM normally arrives as
    // hh_intent_type=REVERSE_MORTGAGE; this covers a pfp_loan_purpose form too.)
    case 'reverse':
    case 'reverse_mortgage':
    case 'hecm':
      return 'REVERSE_MORTGAGE';

    // DSCR / investor → P3 (no INVESTOR enum yet). Leave HOME_PURCHASE.
    case 'dscr':
    case 'investor':
    case 'investment':
      return null;

    default:
      return null;
  }
}

function isLowEngagement(engagement: NonNullable<NurtureGoalInferenceInput['engagement']>): boolean {
  const messages = engagement.recentMessages || [];
  if (messages.length === 0) return true;
  const opened = messages.filter((m) => m.opened).length;
  return opened / messages.length < 0.15;
}

function hasReactivationSignal(meta: Record<string, unknown>): boolean {
  if (meta.hh_rate_drop_signal === true) return true;
  if (meta.life_event_detected === true) return true;
  const currentRate = meta.hh_lien1_rate as number | undefined;
  if (currentRate && currentRate > 6.0) return true;
  return false;
}

function getDaysSince(dateStr: string | undefined): number {
  if (!dateStr) return 0;
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return 0;
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Infer the NurtureGoal for a lead given a signal context.
 *
 * Returns `null` when the signalType is structurally non-goal-shift
 * (caller should early-return without writing precedence-authority audit
 * rows). Returns a `NurtureGoal` for any goal-shift-bearing signalType
 * (or unknown signalType — fail-open to lead-state inference).
 *
 * For Milo compose-time callers (no signal context), pass any non-blocked
 * signalType string (e.g., `'__milo_compose__'`) to bypass signal filtering
 * and run lead-state inference unconditionally.
 */
export function inferNurtureGoal(input: NurtureGoalInferenceInput): NurtureGoal | null {
  // Registry-driven non-goal-shift gate (Wave B). `isGoalShiftSignal` returns
  // `false` ONLY for a type that normalizes to a registered key with
  // `goalShiftSemantics:false`; it FAILS OPEN (`true`) for unregistered, null,
  // or unrecognized types — so the `__milo_compose__` sentinel (unregistered)
  // fails open → `!true === false` → does NOT return null → proceeds to
  // lead-state inference, byte-identical to the pre-Wave-B behavior. SPEC §8
  // decision 9.
  if (!isGoalShiftSignal(input.signalType)) {
    return null;
  }
  return inferFromLeadState(input.lead, input.engagement);
}
