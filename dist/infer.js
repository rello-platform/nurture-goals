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
    // -- Home-Scout contact-form routing (TERTIARY source; 06152026 STEP 2) --
    // Lowest-precedence goal source: fires ONLY when neither HH intent nor a PFP
    // agency/DSCR marker stamped a goal above. The `scout_*` keys come from the
    // Home-Scout contact-form catalog (forward contract → scout-fields v0.4.0).
    // Order is most-specific-first; each returns a goal that already exists in the
    // enum (no new goal is added by STEP 2 — the new dimensions are loanPrograms).
    //
    // 1. Investor / DSCR scout signals → INVESTOR (same goal PFP DSCR routes to).
    if (isScoutInvestorSignal(meta)) {
        return 'INVESTOR';
    }
    // 2. Refinance scout signals → REFINANCE, or EQUITY_ACCESS for cash-out
    //    (mirrors the P1 cash-out → EQUITY_ACCESS mapping).
    const scoutRefi = scoutRefinanceGoal(meta);
    if (scoutRefi !== null) {
        return scoutRefi;
    }
    // 3. Real-estate-hat scout signals → buyer (HOME_PURCHASE) / seller
    //    (HOME_SALE) nurture, NOT a mortgage goal. The MLO cross-sell handoff for
    //    a not-pre-approved buyer is a Rello signal concern (see DISCOVERED), not
    //    a goal decision.
    const scoutRe = scoutRealEstateGoal(meta);
    if (scoutRe !== null) {
        return scoutRe;
    }
    // (A scout purchase / first-time-buyer / construction lead with no more-
    //  specific signal falls through to the HOME_PURCHASE default below — the
    //  loan-program dimension still surfaces FHA_PURCHASE / CONSTRUCTION / NON_QM
    //  via inferLoanProgram, which is where that nuance is carried.)
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
/**
 * Detect a Harvest-Home-sourced investor / non-owner-occupied lead — the
 * DOMINANT DSCR cohort in production. HH stamps `hh_intent_type='INVESTOR'`
 * (its resolved intent), `hh_non_owner_occupied=true` (absentee owner), and/or
 * `hh_investor_subtype` (e.g. 'out_of_state_owner'), but NEVER a `dscr_*` or
 * `scout_*` marker — so these leads were invisible to both `isDscrInvestorSignal`
 * and `isScoutInvestorSignal`, and `inferLoanProgram` returned `null` for them
 * (no DSCR program hook fired). This is the dedicated HH-investor detector.
 *
 * Provenance: ported verbatim from Milo Engine's local `resolveLoanProgram`
 * HH-field fallback (`~/Milo-Engine/src/lib/product-education-scope.ts::
 * isHhInvestorSignal @ f54e83f`, PR #68). Moved INTO this shared package
 * (HH-INVESTOR-LOANPROGRAM-SOT, 06172026) so Rello's compose-thread (which
 * calls the package `inferLoanProgram`, NOT Milo's fallback) ALSO classifies
 * these leads — single source of truth. The Milo local fallback is retired
 * once consumers pin the version that ships this.
 *
 * NOTE this fires ONLY the loan-program dimension (`DSCR`); the GOAL routing in
 * `inferFromLeadState` already routes `hh_intent_type='INVESTOR'` → the
 * INVESTOR goal (and `hh_non_owner_occupied`/`hh_investor_subtype` leads fall
 * through to their stage/default goal — unchanged here; this is the SECONDARY
 * program-dimension fix, not a goal change).
 *
 * Production-safe: tolerates missing / null / wrong-type fields (returns false).
 * Conservative — only the three canonical HH investor markers.
 */
function isHhInvestorSignal(meta) {
    // HH's resolved intent (case-insensitive; mirrors inferFromLeadState's read).
    const intent = meta.hh_intent_type;
    if (typeof intent === 'string' && intent.trim().toUpperCase() === 'INVESTOR') {
        return true;
    }
    // Absentee-owner flag — the canonical DSCR cohort marker.
    if (meta.hh_non_owner_occupied === true)
        return true;
    // Non-empty investor subtype (e.g. 'out_of_state_owner').
    const subtype = meta.hh_investor_subtype;
    if (typeof subtype === 'string' && subtype.trim().length > 0)
        return true;
    return false;
}
// =============================================================================
// Home-Scout contact-form fields (`scout_*`) — TERTIARY inference source.
//   06152026 HS-SCOUT-FIELDS STEP 2 (06142026-NURTURE-AUDIT).
//
//   Precedence: hh_intent_type (P1) wins; pfp_*/dscr_* (P1/P3) next; scout_*
//   fields are the lowest-precedence source and fire ONLY when the higher
//   sources stamped nothing. Mirrors the SECONDARY-source pattern P1/P3 used
//   for pfp_loan_purpose / dscr_intent_type.
//
//   Values are the EXACT slug `value`s the Home-Scout contact-question catalog
//   ships (~/The-Home-Scout/src/lib/contact-question-catalog.ts @ a08db41,
//   slugified via its `opts()` helper: lowercase, non-alphanumeric runs → `-`).
//   They are the forward contract registered in @rello-platform/scout-fields
//   v0.4.0 MILO_AWARE_FIELDS. A typo here = a silently-dropped branch.
// =============================================================================
/**
 * `scout_*` keys under a compliance HOLD — they encode a prohibited-basis
 * attribute (ECOA / Reg B) or otherwise require counsel review before any
 * nurture logic may rely on them. The inference MUST NEVER read or branch on a
 * key in this set; it stays DORMANT until counsel clears it.
 *
 * Mirrors `@rello-platform/scout-fields` `COMPLIANCE_HOLD_KEYS` /
 * `isComplianceHold()` (the canonical contract; today `{scout_age_62_plus}` —
 * prohibited-basis age). Hardcoded here (rather than importing scout-fields) so
 * this package stays dependency-light — nurture-goals reads RAW `scout_*` keys
 * off `Lead.customFields`, it does not resolve field definitions. If scout-fields
 * adds a hold key, mirror it here (and the unit test pins the exclusion).
 */
const SCOUT_COMPLIANCE_HOLD_KEYS = new Set([
    'scout_age_62_plus',
]);
/** True if a scout_* key is on the compliance hold list (never branch on it). */
function isScoutComplianceHold(key) {
    return SCOUT_COMPLIANCE_HOLD_KEYS.has(key);
}
/** Read a scout_* field as a normalized lowercase string, or '' if absent/wrong-type/on-hold. */
function scoutStr(meta, key) {
    // Defense-in-depth: a hold key must NEVER be read, even by an internal helper.
    if (isScoutComplianceHold(key))
        return '';
    const raw = meta[key];
    if (typeof raw !== 'string')
        return '';
    return raw.trim().toLowerCase();
}
/**
 * Is this a Home-Scout INVESTOR/DSCR lead? Reads the investor scout fields:
 *   - `scout_is_investment === 'yes'`, OR
 *   - `scout_occupancy === 'investment'` (the qualifying-pack occupancy field), OR
 *   - `scout_rentals_owned ∈ {1-3, 4} (i.e. owns ≥1 rental — not '0').
 * `scout_expected_rent` is NOT a routing trigger (it is DSCR framing detail used
 * by the composition hook). Null-safe; '' / unknown → false.
 */
function isScoutInvestorSignal(meta) {
    if (scoutStr(meta, 'scout_is_investment') === 'yes')
        return true;
    if (scoutStr(meta, 'scout_occupancy') === 'investment')
        return true;
    const rentals = scoutStr(meta, 'scout_rentals_owned');
    // Catalog values slugify to '0', '1-3', '4'. Anything other than '0'/'' means
    // the borrower owns at least one rental → investor.
    if (rentals !== '' && rentals !== '0')
        return true;
    return false;
}
/**
 * Is this a Home-Scout REFINANCE lead, and toward which goal?
 *   - `scout_loan_purpose === 'refinance'` OR any non-empty `scout_refi_goal`
 *     means a refinance.
 *   - `scout_refi_goal === 'cash-out'` routes the GOAL to EQUITY_ACCESS (mirrors
 *     the P1 cash-out → EQUITY_ACCESS mapping); every other refi goal → REFINANCE.
 * Returns 'EQUITY_ACCESS' | 'REFINANCE' | null (not a refi).
 */
function scoutRefinanceGoal(meta) {
    const purpose = scoutStr(meta, 'scout_loan_purpose');
    const refiGoal = scoutStr(meta, 'scout_refi_goal');
    const isRefi = purpose === 'refinance' || refiGoal !== '';
    if (!isRefi)
        return null;
    if (refiGoal === 'cash-out')
        return 'EQUITY_ACCESS';
    return 'REFINANCE';
}
/**
 * Map a Home-Scout REAL-ESTATE-hat lead to its buyer/seller nurture goal.
 *   - `scout_buy_sell === 'selling'` → HOME_SALE.
 *   - `scout_buy_sell ∈ {buying, both}` → HOME_PURCHASE (buyer-flavor).
 * Returns the RE goal, or null when no RE-hat signal is present.
 *
 * NOTE the cross-sell handoff (an RE buyer with `scout_pre_approved === 'no'`)
 * is a Rello-side signal/enrollment concern, NOT a goal decision — it is filed
 * as a DISCOVERED with the exact mechanism, not implemented in this package.
 */
function scoutRealEstateGoal(meta) {
    const buySell = scoutStr(meta, 'scout_buy_sell');
    if (buySell === 'selling')
        return 'HOME_SALE';
    if (buySell === 'buying' || buySell === 'both')
        return 'HOME_PURCHASE';
    return null;
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
 *   - NON_QM → bank-statement / alt-doc financing for self-employed borrowers
 *     (06152026 HS-SCOUT-FIELDS STEP 2 — driven by scout_income_type /
 *     scout_files_tax_returns).
 *   - CONSTRUCTION → ground-up build or renovation financing
 *     (06152026 HS-SCOUT-FIELDS STEP 2 — driven by scout_construction_type).
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
    // 06152026 HS-SCOUT-FIELDS STEP 2 — two net-new program dimensions driven by
    // Home-Scout contact-form fields (`scout_*`). Neither is a NurtureGoal: a
    // Non-QM borrower is still a HOME_PURCHASE / REFINANCE / INVESTOR by goal, and
    // a construction borrower is still a HOME_PURCHASE; the program rides
    // alongside the goal and steers the composition prompt's program hook.
    'NON_QM',
    'CONSTRUCTION',
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
    // Type-safe read: `hh_intent_type` may be a non-string (e.g. a number) on a
    // malformed customFields blob. `inferLoanProgram` promises never-throws, so
    // coerce defensively rather than `(x as string).toUpperCase()` (which throws
    // on a number). Surfaced by HH-INVESTOR-LOANPROGRAM-SOT null-safety tests.
    const hhRaw = meta.hh_intent_type;
    const hh = typeof hhRaw === 'string' ? hhRaw.toUpperCase() : '';
    if (hh === 'REFI' || hh === 'REFINANCE' || hh === 'RATE_WATCH')
        return true;
    if (hh === 'BUY')
        return false;
    // Home-Scout refi signals (06152026 STEP 2; lowest-precedence). Lets a scout
    // VA-eligible lead in the refinance pack resolve to VA_IRRRL (the streamline
    // refi) rather than VA_PURCHASE. Compliance-hold keys are never read.
    if (scoutRefinanceGoal(meta) !== null)
        return true;
    if (scoutStr(meta, 'scout_construction_type') === 'buying' ||
        scoutStr(meta, 'scout_first_time_buyer') === 'yes') {
        return false;
    }
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
// ---------------------------------------------------------------------------
// Home-Scout program signals (06152026 STEP 2). Read the `scout_*` fields that
// carry program-family meaning. All slug values are byte-matched to the HS
// catalog (a08db41). Compliance-hold keys are never read (scoutStr guards it).
// ---------------------------------------------------------------------------
/**
 * Is this a Home-Scout Non-QM / bank-statement lead? Self-employed-shaped income
 * or no 2-year tax-return history is the genuine Non-QM (alt-doc) trigger:
 *   - `scout_income_type ∈ {self-employed, 1099-contractor, business-owner}`, OR
 *   - `scout_files_tax_returns === 'no'`.
 * `scout_income_type === 'w-2-employee'` is the STANDARD path and does NOT count.
 * Null-safe; absent / unknown → false.
 */
function isScoutNonQm(meta) {
    const income = scoutStr(meta, 'scout_income_type');
    if (income === 'self-employed' ||
        income === '1099-contractor' ||
        income === 'business-owner') {
        return true;
    }
    if (scoutStr(meta, 'scout_files_tax_returns') === 'no')
        return true;
    return false;
}
/**
 * Is this a Home-Scout construction lead? `scout_construction_type ∈
 * {building, renovating}` is construction financing; `buying` is NOT (it is an
 * ordinary purchase). Null-safe; absent / unknown → false.
 */
function isScoutConstruction(meta) {
    const t = scoutStr(meta, 'scout_construction_type');
    return t === 'building' || t === 'renovating';
}
/** Home-Scout VA eligibility flag — `scout_va_eligible === 'yes'`. */
function isScoutVaEligible(meta) {
    return scoutStr(meta, 'scout_va_eligible') === 'yes';
}
/**
 * Is this a Home-Scout FHA-leaning lead (first-time / low-down education)?
 *   - `scout_first_time_buyer === 'yes'`, OR
 *   - `scout_down_payment ∈ {none-yet, under-5}` (the two lowest catalog buckets).
 * These are the borrowers FHA's low-down / flexible-credit angle is written for.
 * Null-safe; absent / unknown → false.
 */
function isScoutFhaLeaning(meta) {
    if (scoutStr(meta, 'scout_first_time_buyer') === 'yes')
        return true;
    const down = scoutStr(meta, 'scout_down_payment');
    if (down === 'none-yet' || down === 'under-5')
        return true;
    return false;
}
/**
 * Infer the loan-program dimension for a lead. Deterministic, null-safe.
 *
 * Resolution order (most-specific / highest-confidence program first). PFP /
 * veteran-flag sources (agency intake) outrank self-reported Home-Scout
 * contact-form answers within the same family, but the scout `*` fields add
 * families PFP never carries (Non-QM, Construction):
 *  1. DSCR — `dscr_*` markers OR Home-Scout investor signals OR HH-sourced
 *     investor signals (`hh_intent_type='INVESTOR'` / `hh_non_owner_occupied` /
 *     `hh_investor_subtype` — the dominant production DSCR cohort).
 *  2. VA family (PFP veteran flag / eligible-programs OR `scout_va_eligible`):
 *       - refinance phase → `VA_IRRRL` (the streamline refi).
 *       - purchase / unknown phase → `VA_PURCHASE`.
 *  3. NON_QM — Home-Scout self-employed / no-tax-return signals (a self-employed
 *     INVESTOR is already DSCR above; this is the owner-occupant alt-doc path).
 *  4. CONSTRUCTION — Home-Scout building / renovating.
 *  5. FHA family:
 *       - cash-out refi → `FHA_CASHOUT`.
 *       - other refinance → `FHA_STREAMLINE`.
 *       - purchase / unknown phase, OR a Home-Scout first-time / low-down lead
 *         → `FHA_PURCHASE`.
 *  6. Conventional family → `CONVENTIONAL`.
 *  7. Otherwise → `null` (no program inferable — no hook fires).
 *
 * VA precedes FHA precedes Conventional because the most-specific eligibility
 * (veteran entitlement) carries the strongest program-specific hook, and a lead
 * eligible for multiple programs should be spoken to in the highest-value lane.
 * DSCR precedes NON_QM because a self-employed investor is best served by the
 * property-cash-flow (DSCR) angle, not the personal alt-doc (bank-statement) one.
 *
 * Never throws; missing / null / wrong-type inputs degrade to `null`.
 */
function inferLoanProgram(input) {
    const meta = input.metadata || {};
    const loanType = input.loanType ?? null;
    // 1. DSCR / investor — PFP DSCR markers OR Home-Scout investor signals OR
    //    HH-sourced investor signals (the dominant production DSCR cohort;
    //    HH-INVESTOR-LOANPROGRAM-SOT, 06172026). ADDITIVE — only newly-classifies
    //    HH-investor leads that previously fell through to `null`.
    if (isDscrInvestorSignal(meta) ||
        isScoutInvestorSignal(meta) ||
        isHhInvestorSignal(meta)) {
        return 'DSCR';
    }
    const refi = refinancePhase(meta);
    const isVet = isVeteranFlag(meta.pfp_is_veteran);
    const hasVa = isVet || hasProgramFamily('VA', meta, loanType) || isScoutVaEligible(meta);
    // 2. VA — veteran entitlement OR VA in the eligible-programs list OR scout flag.
    if (hasVa) {
        // IRRRL is the VA streamline refi; only meaningful on a refinance-phase lead.
        if (refi === true)
            return 'VA_IRRRL';
        return 'VA_PURCHASE';
    }
    // 3. NON_QM — Home-Scout self-employed / no-tax-return owner-occupant path.
    //    (The investor variant already returned DSCR above.)
    if (isScoutNonQm(meta)) {
        return 'NON_QM';
    }
    // 4. CONSTRUCTION — Home-Scout building / renovating.
    if (isScoutConstruction(meta)) {
        return 'CONSTRUCTION';
    }
    // 5. FHA — PFP family OR a Home-Scout first-time / low-down buyer.
    if (hasProgramFamily('FHA', meta, loanType)) {
        if (isCashOutRefi(meta))
            return 'FHA_CASHOUT';
        if (refi === true)
            return 'FHA_STREAMLINE';
        return 'FHA_PURCHASE';
    }
    if (isScoutFhaLeaning(meta)) {
        return 'FHA_PURCHASE';
    }
    // 6. Conventional.
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
