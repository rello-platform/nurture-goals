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
exports.LOAN_PROGRAMS = void 0;
exports.inferNurtureGoal = inferNurtureGoal;
exports.isLoanProgram = isLoanProgram;
exports.inferLoanProgram = inferLoanProgram;
exports.inferNurtureContext = inferNurtureContext;
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
    // INVEST = HH's investor/non-owner-occupied intent (scoring-service.ts
    // detectIntentType + the NA-087 investor short-circuit). Routes to the
    // dedicated INVESTOR goal (06142026-NURTURE-AUDIT P3) so investor-specific
    // framing fires instead of the generic-buyer HOME_PURCHASE default.
    if (hhIntentType === 'INVEST' || hhIntentType === 'INVESTOR') {
        return 'INVESTOR';
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
    // P3 (06142026-NURTURE-AUDIT, DISCOVERED-NURTURE-PFP-DSCR-INVESTOR-GOAL-061426):
    // DSCR / investor leads now route to the dedicated INVESTOR goal (was
    // HOME_PURCHASE in v0.5.0).
    const pfpGoal = mapPfpLoanPurposeToGoal(meta.pfp_loan_purpose);
    if (pfpGoal !== null) {
        return pfpGoal;
    }
    // -- DSCR advisor routing (SECONDARY source; 06142026-NURTURE-AUDIT P3) --
    // PathfinderPro's DSCR advisor (save-lead/route.ts) stamps `dscr_loan_purpose`
    // and `dscr_intent_type='DSCR_INVESTMENT'`, NOT `pfp_loan_purpose`. Read both
    // so DSCR leads reach the INVESTOR goal even though they never populate the
    // PFP agency-intake field above. `hh_intent_type` still wins (handled first);
    // this fires only when HH stamped no intent and PFP stamped no agency purpose.
    if (isDscrInvestorSignal(meta)) {
        return 'INVESTOR';
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
 *   DSCR / investor     → INVESTOR        (06142026-NURTURE-AUDIT P3)
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
function mapPfpLoanPurposeToGoal(raw) {
    if (typeof raw !== 'string')
        return null;
    // Collapse case + any of `-`, ` `, `_` runs to a single underscore so
    // `RATE_TERM_REFI`, `rate-term refi`, and `rate term refi` all normalize alike.
    const norm = raw.trim().toLowerCase().replace(/[\s_-]+/g, '_');
    if (norm === '')
        return null;
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
        // DSCR / investor → INVESTOR (06142026-NURTURE-AUDIT P3). Was `null`
        // (fall-through to HOME_PURCHASE) in v0.5.0; the INVESTOR goal now exists.
        case 'dscr':
        case 'investor':
        case 'investment':
            return 'INVESTOR';
        default:
            return null;
    }
}
/**
 * Detect a DSCR / investor lead from the PathfinderPro DSCR-advisor custom
 * fields (06142026-NURTURE-AUDIT P3). The DSCR advisor stamps
 * `dscr_intent_type='DSCR_INVESTMENT'` and `dscr_loan_purpose` (free-form from
 * the borrower's selected purpose), NOT `pfp_loan_purpose` — so DSCR leads
 * never reach `mapPfpLoanPurposeToGoal`. This is the dedicated detector.
 *
 * Production-safe: tolerates missing / null / non-string fields (returns false).
 * Case-insensitive; substring-tolerant on `dscr_loan_purpose` so values like
 * `"DSCR investment"` / `"Investor"` still match.
 */
function isDscrInvestorSignal(meta) {
    // Canonical marker the DSCR advisor always stamps.
    const intentType = meta.dscr_intent_type;
    if (typeof intentType === 'string' && intentType.trim().length > 0) {
        // Any non-empty dscr_intent_type means the DSCR advisor produced this lead.
        return true;
    }
    // Secondary: the borrower's free-form DSCR loan purpose.
    const purpose = meta.dscr_loan_purpose;
    if (typeof purpose === 'string') {
        const norm = purpose.trim().toLowerCase();
        if (norm.includes('dscr') ||
            norm.includes('investor') ||
            norm.includes('investment') ||
            norm.includes('rental')) {
            return true;
        }
    }
    return false;
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
// =============================================================================
// LoanProgram — SECONDARY messaging dimension (06142026-NURTURE-AUDIT P3).
// =============================================================================
/**
 * The loan-program dimension. Rides ALONGSIDE the NurtureGoal as secondary
 * metadata — it does NOT change which goal is selected (the one exception is
 * DSCR/investor, which routes the GOAL to INVESTOR via `inferFromLeadState`;
 * here it ALSO surfaces as `DSCR` so the prompt can speak to DSCR mechanics).
 *
 * Steers framework emphasis + the composition prompt's program-specific hooks:
 *   - VA_IRRRL / FHA_STREAMLINE → the streamline-refi hooks (limited docs,
 *     no/low new appraisal, faster close) Kelly specifically flagged.
 *   - DSCR → "qualify on the property's cash flow, not personal income".
 *   - VA_PURCHASE → $0-down eligibility (entitlement-conditional).
 *   - FHA_PURCHASE → low-down / flexible-credit.
 *
 * `null` means no program could be inferred → no program-specific hook fires
 * (the message stays purely goal-driven, byte-identical to pre-P3 behavior).
 */
exports.LOAN_PROGRAMS = [
    'VA_PURCHASE',
    'VA_IRRRL',
    'FHA_PURCHASE',
    'FHA_STREAMLINE',
    'FHA_CASHOUT',
    'CONVENTIONAL',
    'DSCR',
];
const LOAN_PROGRAM_SET = new Set(exports.LOAN_PROGRAMS);
/** Type guard: is this value a canonical LoanProgram? */
function isLoanProgram(value) {
    return typeof value === 'string' && LOAN_PROGRAM_SET.has(value);
}
/** Truthy-string / boolean / numeric coercion for the veteran flag. */
function isVeteranFlag(raw) {
    if (raw === true)
        return true;
    if (typeof raw === 'number')
        return raw === 1;
    if (typeof raw === 'string') {
        const norm = raw.trim().toLowerCase();
        return norm === 'true' || norm === 'yes' || norm === 'y' || norm === '1';
    }
    return false;
}
/**
 * Is this a refinance-phase lead (vs. a purchase)? Reads `pfp_loan_purpose`
 * first (the explicit signal), then `hh_intent_type`. Returns:
 *  - `true`  — refinance phase (rate/term OR cash-out OR HH REFI/RATE_WATCH).
 *  - `false` — purchase phase (explicit PURCHASE / HH BUY).
 *  - `null`  — unknown (neither field disambiguates).
 */
function refinancePhase(meta) {
    const goal = mapPfpLoanPurposeToGoal(meta.pfp_loan_purpose);
    if (goal === 'REFINANCE' || goal === 'EQUITY_ACCESS')
        return true;
    if (goal === 'HOME_PURCHASE')
        return false;
    const hh = (meta.hh_intent_type || '').toUpperCase();
    if (hh === 'REFI' || hh === 'REFINANCE' || hh === 'RATE_WATCH')
        return true;
    if (hh === 'BUY')
        return false;
    return null;
}
/** Does this lead's cash-out refi signal fire (for FHA_CASHOUT)? */
function isCashOutRefi(meta) {
    return mapPfpLoanPurposeToGoal(meta.pfp_loan_purpose) === 'EQUITY_ACCESS';
}
/**
 * Does the lead's program-family data include a given family? Reads PFP's
 * comma-joined `pfp_eligible_programs` first, then falls back to the coarse
 * `Transaction.loanType`. Case / spacing tolerant.
 */
function hasProgramFamily(family, meta, loanType) {
    const tokens = [];
    const eligible = meta.pfp_eligible_programs;
    if (typeof eligible === 'string') {
        for (const t of eligible.split(','))
            tokens.push(t.trim().toUpperCase());
    }
    if (typeof loanType === 'string' && loanType.trim()) {
        tokens.push(loanType.trim().toUpperCase());
    }
    // Normalize family aliases: "CONVENTIONAL" only; "VA"/"FHA" exact-ish.
    return tokens.some((t) => {
        if (family === 'CONVENTIONAL')
            return t === 'CONVENTIONAL' || t === 'CONV';
        return t === family || t.startsWith(family + ' ') || t.startsWith(family + '_');
    });
}
/**
 * Infer the loan-program dimension for a lead. Deterministic, null-safe.
 *
 * Resolution order (most-specific program first):
 *  1. DSCR — `dscr_intent_type` / `dscr_loan_purpose` markers (investor).
 *  2. VA family:
 *       - refinance phase → `VA_IRRRL` (the streamline refi).
 *       - purchase / unknown phase → `VA_PURCHASE`.
 *  3. FHA family:
 *       - cash-out refi → `FHA_CASHOUT`.
 *       - other refinance → `FHA_STREAMLINE`.
 *       - purchase / unknown phase → `FHA_PURCHASE`.
 *  4. Conventional family → `CONVENTIONAL`.
 *  5. Otherwise → `null` (no program inferable — no hook fires).
 *
 * VA precedes FHA precedes Conventional because the most-specific eligibility
 * (veteran entitlement) carries the strongest program-specific hook, and a lead
 * eligible for multiple programs should be spoken to in the highest-value lane.
 *
 * Never throws; missing / null / wrong-type inputs degrade to `null`.
 */
function inferLoanProgram(input) {
    const meta = input.metadata || {};
    const loanType = input.loanType ?? null;
    // 1. DSCR / investor.
    if (isDscrInvestorSignal(meta)) {
        return 'DSCR';
    }
    const refi = refinancePhase(meta);
    const isVet = isVeteranFlag(meta.pfp_is_veteran);
    const hasVa = isVet || hasProgramFamily('VA', meta, loanType);
    // 2. VA — veteran entitlement OR VA in the eligible-programs list.
    if (hasVa) {
        // IRRRL is the VA streamline refi; only meaningful on a refinance-phase lead.
        if (refi === true)
            return 'VA_IRRRL';
        return 'VA_PURCHASE';
    }
    // 3. FHA.
    if (hasProgramFamily('FHA', meta, loanType)) {
        if (isCashOutRefi(meta))
            return 'FHA_CASHOUT';
        if (refi === true)
            return 'FHA_STREAMLINE';
        return 'FHA_PURCHASE';
    }
    // 4. Conventional.
    if (hasProgramFamily('CONVENTIONAL', meta, loanType)) {
        return 'CONVENTIONAL';
    }
    // 5. No program inferable.
    return null;
}
/**
 * Infer BOTH the NurtureGoal and the LoanProgram dimension for a lead.
 *
 * `goal` follows the exact semantics of `inferNurtureGoal` (including the
 * non-goal-shift `null` gate). `loanProgram` is always computed from lead state
 * (it has no signal gate — it is pure metadata about the lead), so a caller
 * that gets `goal: null` may still get a non-null `loanProgram`; the caller
 * decides whether to use it. For compose-time callers (`__milo_compose__`
 * sentinel), `goal` is the resolved goal and `loanProgram` rides alongside.
 *
 * Never throws.
 */
function inferNurtureContext(input) {
    return {
        goal: inferNurtureGoal(input),
        loanProgram: inferLoanProgram({ metadata: input.lead.metadata || {} }),
    };
}
