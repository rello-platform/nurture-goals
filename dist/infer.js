"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferNurtureGoal = inferNurtureGoal;
const signals_1 = require("@rello-platform/signals");
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
function inferFromLeadState(lead, engagement) {
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
    const hhIntentType = (meta.hh_intent_type || '').toUpperCase();
    const hhTemperature = (meta.hh_temperature || '').toUpperCase();
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
    const isPostSale = stage === 'CLOSED' ||
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
        const daysSinceClose = getDaysSince(meta.closedAt);
        if (daysSinceClose >= 90 && engagement && !isLowEngagement(engagement)) {
            return 'REFERRAL';
        }
        return 'RELATIONSHIP';
    }
    // Default
    return 'HOME_PURCHASE';
}
function isLowEngagement(engagement) {
    const messages = engagement.recentMessages || [];
    if (messages.length === 0)
        return true;
    const opened = messages.filter((m) => m.opened).length;
    return opened / messages.length < 0.15;
}
function hasReactivationSignal(meta) {
    if (meta.hh_rate_drop_signal === true)
        return true;
    if (meta.life_event_detected === true)
        return true;
    const currentRate = meta.hh_lien1_rate;
    if (currentRate && currentRate > 6.0)
        return true;
    return false;
}
function getDaysSince(dateStr) {
    if (!dateStr)
        return 0;
    const then = new Date(dateStr);
    if (isNaN(then.getTime()))
        return 0;
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
function inferNurtureGoal(input) {
    // Registry-driven non-goal-shift gate (Wave B). `isGoalShiftSignal` returns
    // `false` ONLY for a type that normalizes to a registered key with
    // `goalShiftSemantics:false`; it FAILS OPEN (`true`) for unregistered, null,
    // or unrecognized types — so the `__milo_compose__` sentinel (unregistered)
    // fails open → `!true === false` → does NOT return null → proceeds to
    // lead-state inference, byte-identical to the pre-Wave-B behavior. SPEC §8
    // decision 9.
    if (!(0, signals_1.isGoalShiftSignal)(input.signalType)) {
        return null;
    }
    return inferFromLeadState(input.lead, input.engagement);
}
