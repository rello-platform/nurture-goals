/**
 * Canonical NurtureGoal registry for the Rello platform.
 *
 * This package is the single source of truth for (a) the set of nurture
 * goals the platform supports, (b) per-goal display metadata (used to seed
 * Rello's `CampaignGoal` table), (c) the agent-authored priming-facts
 * category registry (AboutMe pattern — see LEAD-COHORT-CAMPAIGN-BUILDER
 * spec B-03), and (d) the topic-exclusion key mapping used to honor
 * `Lead.leadTopicExclusions` per B-10.
 *
 * Consumers:
 * - Rello: `Campaign.goalKey` FKs to `CampaignGoal.key` (seeded from
 *   NURTURE_GOAL_METADATA); `Campaign.primingFacts[].category` validated
 *   against PRIMING_CATEGORIES_BY_GOAL[goalKey]; cohort resolver and
 *   nurture guardrails filter by TOPIC_EXCLUSION_KEYS_BY_GOAL.
 * - Milo Engine: NurtureGoal type drives framework selection and per-goal
 *   outcome weights. Milo's own `src/lib/nurture-goals.ts` currently
 *   redeclares this type — Phase 4 of the Lead-Cohort-Campaign build will
 *   replace that duplicate with an import from this package.
 *
 * Decision history:
 * - Goal list matches Milo Engine's NurtureGoal enum exactly (verified
 *   2026-04-21 against Milo-Engine/src/lib/nurture-goals.ts:14-24).
 *   Changing the list here WITHOUT coordinating with Milo would create
 *   compile-time drift on the composition side.
 * - Priming pattern (AboutMe per B-03): per-entry { text, category };
 *   category must be a valid PrimingCategoryKey for the selected goal.
 *   6 universal categories + 1-3 goal-specific categories.
 * - Topic exclusions (B-10): only goals with a commercially-meaningful
 *   topic opt-out appear in the map. RELATIONSHIP and BRAND_AWARENESS are
 *   intentionally omitted — they don't map to a consumer opt-out category.
 */
/**
 * Platform-canonical nurture goals. This list must match Milo Engine's
 * NurtureGoal union exactly (Milo's frameworks.ts + nurture-goals.ts key
 * off these values). Add a new goal here ONLY when Milo has a goal-specific
 * rule path and framework mapping to receive it.
 */
export declare const NURTURE_GOALS: readonly ["HOME_PURCHASE", "REFINANCE", "REVERSE_MORTGAGE", "EQUITY_ACCESS", "REACTIVATION", "RELATIONSHIP", "REFERRAL", "HOME_SALE", "LISTING_CONVERSION", "BRAND_AWARENESS"];
export type NurtureGoal = (typeof NURTURE_GOALS)[number];
/** Type guard: is this value a canonical NurtureGoal? */
export declare function isNurtureGoal(value: unknown): value is NurtureGoal;
export interface NurtureGoalMetadata {
    key: NurtureGoal;
    displayName: string;
    description: string;
    sortOrder: number;
}
/**
 * Platform-level display metadata. Rello's seed script idempotently
 * upserts a `CampaignGoal` row per entry. Per-tenant customization
 * (rename, disable, reorder) is a v2 follow-up — a separate
 * `CampaignGoalTenantSetting` table will carry overrides without
 * mutating these platform defaults.
 *
 * sortOrder reflects the expected frequency-of-use in v1: transactional
 * goals (purchase, refinance, equity products) first, relationship goals
 * in the middle, education goals last.
 */
export declare const NURTURE_GOAL_METADATA: Readonly<Record<NurtureGoal, NurtureGoalMetadata>>;
/**
 * Maximum characters per priming-facts entry. Keeps Milo's prompt context
 * lean and forces pithy agent input. Enforced at UI and write-time.
 */
export declare const MAX_PRIMING_TEXT_LENGTH = 280;
/**
 * Every category key in the platform. Goal-specific categories only apply
 * to the goals listed in PRIMING_CATEGORIES_BY_GOAL; the universal six
 * apply to every goal.
 */
export declare const PRIMING_CATEGORY_KEYS: readonly ["thesis", "audience_note", "lean_into", "steer_clear", "frame", "cta", "buyer_segment", "program_angle", "rate_argument", "prior_rate_assumption", "break_even_note", "security_thesis", "family_note", "use_case", "rate_math_note", "prior_relationship", "reactivation_reason", "personal_anchor", "occasion", "referral_ask_style", "incentive_note", "value_position", "life_stage_note", "agent_fit", "qualifying_signal", "educational_topic", "proof_point"];
export type PrimingCategoryKey = (typeof PRIMING_CATEGORY_KEYS)[number];
/** Type guard: is this string a canonical priming category key? */
export declare function isPrimingCategoryKey(value: unknown): value is PrimingCategoryKey;
export interface PrimingCategory {
    key: PrimingCategoryKey;
    label: string;
    guidance: string;
    /**
     * When true, the UI blocks campaign launch until at least one entry
     * exists in this category. When false, the category is offered in the
     * dropdown but not required.
     */
    required: boolean;
}
/**
 * The six categories that apply to every nurture goal. Seven stay at the
 * top of the priming step in the UI regardless of goal selection.
 */
export declare const UNIVERSAL_PRIMING_CATEGORIES: readonly PrimingCategory[];
/**
 * Goal-specific additions. Each entry is appended to the universal six
 * when that goal is selected. The required entry for each goal anchors
 * the narrative direction (Milo depends on it); optional entries refine.
 */
export declare const PRIMING_CATEGORIES_BY_GOAL: Readonly<Record<NurtureGoal, readonly PrimingCategory[]>>;
/**
 * Return the priming categories valid for a given goal. Callers that
 * iterate (UI dropdown, launch-readiness validator, Milo prompt builder)
 * should use this rather than indexing PRIMING_CATEGORIES_BY_GOAL directly
 * — this function narrows the goal type and errors on unknown input.
 */
export declare function getPrimingCategoriesForGoal(goal: NurtureGoal): readonly PrimingCategory[];
/**
 * Category keys that MUST have at least one entry before a campaign can
 * launch. The UI gates the Launch button on this; the launch endpoint
 * revalidates server-side (trust-but-verify).
 */
export declare function getRequiredPrimingCategoryKeys(goal: NurtureGoal): PrimingCategoryKey[];
/**
 * Is this category key valid for this goal? A key valid for goal A may
 * not be valid for goal B (e.g., `buyer_segment` is HOME_PURCHASE-only).
 * Used by Campaign.primingFacts write-time validation.
 */
export declare function isValidPrimingCategoryForGoal(goal: NurtureGoal, categoryKey: string): categoryKey is PrimingCategoryKey;
/**
 * Maps a nurture goal to the `Lead.leadTopicExclusions` key that, when
 * present, removes the lead from the campaign's cohort (at launch) and
 * blocks further sends (mid-flight — triggers TOPIC_OPT_OUT exit).
 *
 * RELATIONSHIP and BRAND_AWARENESS are intentionally omitted — they do
 * not map to a commercially-meaningful topic opt-out. Baseline unsubscribe
 * is the only applicable gate for those goals. Callers MUST handle the
 * absence case (no-op), not assume every goal has an entry.
 *
 * Values are lowercase-underscore topic keys to match the platform's
 * existing `leadTopicExclusions` convention.
 */
export declare const TOPIC_EXCLUSION_KEYS_BY_GOAL: Readonly<Partial<Record<NurtureGoal, string>>>;
/**
 * Returns the topic-exclusion key for this goal, or null if the goal has
 * no meaningful topic opt-out. Callers should branch on null (skip the
 * filter / skip the guardrail check).
 */
export declare function getTopicExclusionKey(goal: NurtureGoal): string | null;
//# sourceMappingURL=index.d.ts.map