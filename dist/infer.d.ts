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
//# sourceMappingURL=infer.d.ts.map