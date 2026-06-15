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
         * `hh_lien1_rate`, and — as a SECONDARY source when `hh_intent_type` is
         * absent — `pfp_loan_purpose` (PathfinderPro agency-intake vocabulary) and
         * `dscr_intent_type` / `dscr_loan_purpose` (PathfinderPro DSCR-advisor
         * markers → INVESTOR goal, 06142026-NURTURE-AUDIT P3). The loan-program
         * dimension (`inferLoanProgram`) additionally reads `pfp_is_veteran` and
         * `pfp_eligible_programs`. Tolerates missing fields.
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
        recentMessages: ReadonlyArray<{
            opened: boolean;
        }>;
    };
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
export declare function inferNurtureGoal(input: NurtureGoalInferenceInput): NurtureGoal | null;
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
export declare const LOAN_PROGRAMS: readonly ["VA_PURCHASE", "VA_IRRRL", "FHA_PURCHASE", "FHA_STREAMLINE", "FHA_CASHOUT", "CONVENTIONAL", "DSCR", "NON_QM", "CONSTRUCTION"];
export type LoanProgram = (typeof LOAN_PROGRAMS)[number];
/** Type guard: is this value a canonical LoanProgram? */
export declare function isLoanProgram(value: unknown): value is LoanProgram;
/**
 * Input to `inferLoanProgram`. A thin lead-shape — only the fields the
 * inference reads. All optional / null-tolerant.
 */
export interface LoanProgramInferenceInput {
    /**
     * Lead.customFields / metadata blob. Reads (all optional, all tolerant of
     * missing / null / wrong-type):
     *  - `pfp_is_veteran`        — PFP veteran flag (bool, 'true'/'yes', or 1).
     *  - `pfp_eligible_programs` — PFP comma-joined program names
     *                              (e.g. "Conventional, FHA, VA").
     *  - `pfp_loan_purpose`      — PFP agency-intake purpose
     *                              (PURCHASE / RATE_TERM_REFI / CASH_OUT_REFI).
     *  - `dscr_intent_type` / `dscr_loan_purpose` — PFP DSCR-advisor markers.
     *  - `hh_intent_type`        — HH intent (REFI / RATE_WATCH / BUY / INVEST …)
     *                              used to decide purchase-vs-refinance phase when
     *                              `pfp_loan_purpose` is absent.
     *  - `scout_*`               — Home-Scout contact-form answers (06152026
     *                              STEP 2; lowest-precedence source). Reads
     *                              scout_income_type, scout_files_tax_returns
     *                              (→ NON_QM), scout_is_investment /
     *                              scout_occupancy / scout_rentals_owned (→ DSCR),
     *                              scout_va_eligible (→ VA), scout_construction_type
     *                              (→ CONSTRUCTION), scout_first_time_buyer /
     *                              scout_down_payment (→ FHA_PURCHASE),
     *                              scout_loan_purpose / scout_refi_goal (→ refi
     *                              phase). NEVER reads any COMPLIANCE-HOLD key
     *                              (e.g. scout_age_62_plus — prohibited-basis age).
     */
    metadata: Record<string, unknown>;
    /**
     * Transaction.loanType, when the caller has loaded it (Rello
     * schema.prisma:1159). A coarse program family string
     * (e.g. 'VA' / 'FHA' / 'CONVENTIONAL'). Used as a fallback program-family
     * source when the PFP `pfp_eligible_programs` field is absent.
     */
    loanType?: string | null;
}
/**
 * Infer the loan-program dimension for a lead. Deterministic, null-safe.
 *
 * Resolution order (most-specific / highest-confidence program first). PFP /
 * veteran-flag sources (agency intake) outrank self-reported Home-Scout
 * contact-form answers within the same family, but the scout `*` fields add
 * families PFP never carries (Non-QM, Construction):
 *  1. DSCR — `dscr_*` markers OR Home-Scout investor signals.
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
export declare function inferLoanProgram(input: LoanProgramInferenceInput): LoanProgram | null;
/**
 * The combined inference result: the primary NurtureGoal plus the secondary
 * loan-program dimension. Milo's compose-time wrapper and Rello's connector
 * call `inferNurtureContext` so they get both axes from one source of truth.
 */
export interface NurtureContext {
    /** The primary goal (or `null` for a structurally non-goal-shift signal). */
    goal: NurtureGoal | null;
    /** The secondary loan-program dimension (or `null` if none inferable). */
    loanProgram: LoanProgram | null;
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
export declare function inferNurtureContext(input: NurtureGoalInferenceInput): NurtureContext;
//# sourceMappingURL=infer.d.ts.map