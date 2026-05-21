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
     * `hh_lien1_rate`. Tolerates missing fields.
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

/**
 * SignalTypes that are structurally non-goal-shift. Callers receive `null`
 * and short-circuit without writing precedence-authority audit rows.
 *
 * Sourced from NURTURE-PRECEDENCE-AUTHORITY-SPEC-260520.md Hole 1 amendment
 * (line 39 enumerates the canonical non-goal-shift examples).
 */
const NON_GOAL_SHIFT_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  'appraisal_concern',
  'email_complained',
  'email_unsubscribed',
  'email_bounced',
]);

/**
 * SignalType prefixes that are non-goal-shift. Matches any signalType
 * beginning with the prefix (e.g., `agent_action.task_completed`,
 * `deal_distress.appraisal_low`, `compliance.consent_revoked`).
 */
const NON_GOAL_SHIFT_SIGNAL_PREFIXES: ReadonlyArray<string> = [
  'agent_action.',
  'deal_distress.',
  'compliance.',
];

function isNonGoalShiftSignal(signalType: string): boolean {
  if (NON_GOAL_SHIFT_SIGNAL_TYPES.has(signalType)) return true;
  return NON_GOAL_SHIFT_SIGNAL_PREFIXES.some((p) => signalType.startsWith(p));
}

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
  if (isNonGoalShiftSignal(input.signalType)) {
    return null;
  }
  return inferFromLeadState(input.lead, input.engagement);
}
