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

// =============================================================================
// NurtureGoal — the "why" behind every campaign
// =============================================================================

/**
 * Platform-canonical nurture goals. This list must match Milo Engine's
 * NurtureGoal union exactly (Milo's frameworks.ts + nurture-goals.ts key
 * off these values). Add a new goal here ONLY when Milo has a goal-specific
 * rule path and framework mapping to receive it.
 */
export const NURTURE_GOALS = [
  "HOME_PURCHASE",
  "REFINANCE",
  "REVERSE_MORTGAGE",
  "EQUITY_ACCESS",
  "REACTIVATION",
  "RELATIONSHIP",
  "REFERRAL",
  "HOME_SALE",
  "LISTING_CONVERSION",
  "BRAND_AWARENESS",
] as const;

export type NurtureGoal = (typeof NURTURE_GOALS)[number];

const NURTURE_GOAL_SET: ReadonlySet<NurtureGoal> = new Set<NurtureGoal>(NURTURE_GOALS);

/** Type guard: is this value a canonical NurtureGoal? */
export function isNurtureGoal(value: unknown): value is NurtureGoal {
  return typeof value === "string" && NURTURE_GOAL_SET.has(value as NurtureGoal);
}

// =============================================================================
// NURTURE_GOAL_METADATA — display seed data for Rello's CampaignGoal table
// =============================================================================

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
export const NURTURE_GOAL_METADATA: Readonly<Record<NurtureGoal, NurtureGoalMetadata>> = {
  HOME_PURCHASE: {
    key: "HOME_PURCHASE",
    displayName: "Purchase / Buyer Opportunity",
    description: "Leads actively in-market to buy — first-time, move-up, relocation, investor, luxury.",
    sortOrder: 10,
  },
  REFINANCE: {
    key: "REFINANCE",
    displayName: "Refinance Opportunity",
    description: "Past clients or owners whose rate/payment math newly favors a refinance.",
    sortOrder: 20,
  },
  REVERSE_MORTGAGE: {
    key: "REVERSE_MORTGAGE",
    displayName: "Reverse Mortgage",
    description: "62+ equity-anchored owners — security framing, slow relationship arc, family-involved.",
    sortOrder: 30,
  },
  EQUITY_ACCESS: {
    key: "EQUITY_ACCESS",
    displayName: "Equity Access (HELOC / 2nd Lien)",
    description: "Rate-locked owners with high equity — HELOC or second-lien candidates.",
    sortOrder: 40,
  },
  REACTIVATION: {
    key: "REACTIVATION",
    displayName: "Reactivation / Past Client Revival",
    description: "Past clients with a new trigger — rate drop, life event, market shift.",
    sortOrder: 50,
  },
  RELATIONSHIP: {
    key: "RELATIONSHIP",
    displayName: "Relationship / Sphere Nurture",
    description: "Sphere-of-influence nurture to stay top-of-mind; no transactional ask.",
    sortOrder: 60,
  },
  REFERRAL: {
    key: "REFERRAL",
    displayName: "Referral Cultivation",
    description: "Post-close clients with high engagement — cultivate referrals over time.",
    sortOrder: 70,
  },
  HOME_SALE: {
    key: "HOME_SALE",
    displayName: "Home Sale / Listing Prep",
    description: "Owners considering selling — equity-position framing, market-timing math.",
    sortOrder: 80,
  },
  LISTING_CONVERSION: {
    key: "LISTING_CONVERSION",
    displayName: "Listing Conversion (Agent Referral)",
    description: "FSBO / expired listings — convert to an agent relationship.",
    sortOrder: 90,
  },
  BRAND_AWARENESS: {
    key: "BRAND_AWARENESS",
    displayName: "Brand Awareness / Education",
    description: "Cold leads warming — educational angle, no direct pitch.",
    sortOrder: 100,
  },
};

// =============================================================================
// Priming categories (B-03 — AboutMe pattern)
// =============================================================================

/**
 * Maximum characters per priming-facts entry. Keeps Milo's prompt context
 * lean and forces pithy agent input. Enforced at UI and write-time.
 */
export const MAX_PRIMING_TEXT_LENGTH = 280;

/**
 * Every category key in the platform. Goal-specific categories only apply
 * to the goals listed in PRIMING_CATEGORIES_BY_GOAL; the universal six
 * apply to every goal.
 */
export const PRIMING_CATEGORY_KEYS = [
  // Universal (apply to every goal)
  "thesis",
  "audience_note",
  "lean_into",
  "steer_clear",
  "frame",
  "cta",
  // HOME_PURCHASE
  "buyer_segment",
  "program_angle",
  // REFINANCE
  "rate_argument",
  "prior_rate_assumption",
  "break_even_note",
  // REVERSE_MORTGAGE
  "security_thesis",
  "family_note",
  // EQUITY_ACCESS
  "use_case",
  "rate_math_note",
  // REACTIVATION
  "prior_relationship",
  "reactivation_reason",
  // RELATIONSHIP
  "personal_anchor",
  "occasion",
  // REFERRAL
  "referral_ask_style",
  "incentive_note",
  // HOME_SALE
  "value_position",
  "life_stage_note",
  // LISTING_CONVERSION
  "agent_fit",
  "qualifying_signal",
  // BRAND_AWARENESS
  "educational_topic",
  "proof_point",
] as const;

export type PrimingCategoryKey = (typeof PRIMING_CATEGORY_KEYS)[number];

const PRIMING_CATEGORY_KEY_SET: ReadonlySet<PrimingCategoryKey> =
  new Set<PrimingCategoryKey>(PRIMING_CATEGORY_KEYS);

/** Type guard: is this string a canonical priming category key? */
export function isPrimingCategoryKey(value: unknown): value is PrimingCategoryKey {
  return typeof value === "string" && PRIMING_CATEGORY_KEY_SET.has(value as PrimingCategoryKey);
}

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
export const UNIVERSAL_PRIMING_CATEGORIES: readonly PrimingCategory[] = [
  {
    key: "thesis",
    label: "Why this campaign, why now",
    guidance: "The trigger — rate drop, seasonal move, news event, life moment.",
    required: true,
  },
  {
    key: "audience_note",
    label: "What's distinctive about this audience",
    guidance:
      "Your local knowledge the filter doesn't capture — e.g., \"these are 2021 closes who likely locked at 3.5%\".",
    required: false,
  },
  {
    key: "lean_into",
    label: "Lean into",
    guidance: "Angles to emphasize — facts, themes, proof points.",
    required: false,
  },
  {
    key: "steer_clear",
    label: "Steer clear of",
    guidance: "Things to avoid or downplay — pressure language, certain topics.",
    required: false,
  },
  {
    key: "frame",
    label: "Tone or framing",
    guidance: "Overall direction — \"math-forward, not emotional,\" \"warm check-in, no pitch\".",
    required: false,
  },
  {
    key: "cta",
    label: "Ideal next step",
    guidance: "What you want these leads to do — reply, book a call, tap a link, forward.",
    required: false,
  },
];

/**
 * Goal-specific additions. Each entry is appended to the universal six
 * when that goal is selected. The required entry for each goal anchors
 * the narrative direction (Milo depends on it); optional entries refine.
 */
export const PRIMING_CATEGORIES_BY_GOAL: Readonly<Record<NurtureGoal, readonly PrimingCategory[]>> = {
  HOME_PURCHASE: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "buyer_segment",
      label: "Buyer segment",
      guidance: "First-time / move-up / relocation / investor / luxury.",
      required: true,
    },
    {
      key: "program_angle",
      label: "Program angle",
      guidance: "DPA, FHA, VA, conventional focus if any.",
      required: false,
    },
  ],
  REFINANCE: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "rate_argument",
      label: "Rate argument",
      guidance: "Target rate / payment / savings math.",
      required: true,
    },
    {
      key: "prior_rate_assumption",
      label: "Prior rate assumption",
      guidance: "What rate these folks likely have.",
      required: false,
    },
    {
      key: "break_even_note",
      label: "Break-even note",
      guidance: "How the math plays over time.",
      required: false,
    },
  ],
  REVERSE_MORTGAGE: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "security_thesis",
      label: "Security thesis",
      guidance: "Retirement income / aging-in-place / legacy framing.",
      required: true,
    },
    {
      key: "family_note",
      label: "Family note",
      guidance: "Single / couple / heir considerations if known.",
      required: false,
    },
  ],
  EQUITY_ACCESS: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "use_case",
      label: "Use case",
      guidance: "Home improvement / debt consolidation / education / investment.",
      required: true,
    },
    {
      key: "rate_math_note",
      label: "Rate math note",
      guidance: "2nd-lien vs. credit card vs. refi comparison.",
      required: false,
    },
  ],
  REACTIVATION: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "prior_relationship",
      label: "Prior relationship",
      guidance: "What to reference from before.",
      required: true,
    },
    {
      key: "reactivation_reason",
      label: "Reactivation reason",
      guidance: "What's changed (market, life, season).",
      required: false,
    },
  ],
  RELATIONSHIP: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "personal_anchor",
      label: "Personal anchor",
      guidance: "Specific connection point — shared hobby, family tie, community.",
      required: true,
    },
    {
      key: "occasion",
      label: "Occasion",
      guidance: "Holiday / season / milestone if applicable.",
      required: false,
    },
  ],
  REFERRAL: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "referral_ask_style",
      label: "Referral ask style",
      guidance: "Gentle / explicit / event-triggered.",
      required: true,
    },
    {
      key: "incentive_note",
      label: "Incentive note",
      guidance: "Any recognition or gift program.",
      required: false,
    },
  ],
  HOME_SALE: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "value_position",
      label: "Value position",
      guidance: "Equity / market-timing math.",
      required: true,
    },
    {
      key: "life_stage_note",
      label: "Life stage note",
      guidance: "Empty-nester / relocation / right-sizing.",
      required: false,
    },
  ],
  LISTING_CONVERSION: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "agent_fit",
      label: "Agent fit",
      guidance: "Why this agent for these leads.",
      required: true,
    },
    {
      key: "qualifying_signal",
      label: "Qualifying signal",
      guidance: "What signaled their intent.",
      required: false,
    },
  ],
  BRAND_AWARENESS: [
    ...UNIVERSAL_PRIMING_CATEGORIES,
    {
      key: "educational_topic",
      label: "Educational topic",
      guidance: "The specific learning angle.",
      required: true,
    },
    {
      key: "proof_point",
      label: "Proof point",
      guidance: "Credibility anchor — data, case, experience.",
      required: false,
    },
  ],
};

/**
 * Return the priming categories valid for a given goal. Callers that
 * iterate (UI dropdown, launch-readiness validator, Milo prompt builder)
 * should use this rather than indexing PRIMING_CATEGORIES_BY_GOAL directly
 * — this function narrows the goal type and errors on unknown input.
 */
export function getPrimingCategoriesForGoal(goal: NurtureGoal): readonly PrimingCategory[] {
  return PRIMING_CATEGORIES_BY_GOAL[goal];
}

/**
 * Category keys that MUST have at least one entry before a campaign can
 * launch. The UI gates the Launch button on this; the launch endpoint
 * revalidates server-side (trust-but-verify).
 */
export function getRequiredPrimingCategoryKeys(goal: NurtureGoal): PrimingCategoryKey[] {
  return PRIMING_CATEGORIES_BY_GOAL[goal]
    .filter((c) => c.required)
    .map((c) => c.key);
}

/**
 * Is this category key valid for this goal? A key valid for goal A may
 * not be valid for goal B (e.g., `buyer_segment` is HOME_PURCHASE-only).
 * Used by Campaign.primingFacts write-time validation.
 */
export function isValidPrimingCategoryForGoal(
  goal: NurtureGoal,
  categoryKey: string,
): categoryKey is PrimingCategoryKey {
  if (!isPrimingCategoryKey(categoryKey)) return false;
  return PRIMING_CATEGORIES_BY_GOAL[goal].some((c) => c.key === categoryKey);
}

// =============================================================================
// Topic exclusions (B-10)
// =============================================================================

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
export const TOPIC_EXCLUSION_KEYS_BY_GOAL: Readonly<Partial<Record<NurtureGoal, string>>> = {
  HOME_PURCHASE: "purchase",
  REFINANCE: "refinance",
  REVERSE_MORTGAGE: "reverse_mortgage",
  EQUITY_ACCESS: "equity_access",
  REACTIVATION: "reactivation",
  REFERRAL: "referral",
  HOME_SALE: "home_sale",
  LISTING_CONVERSION: "listing_conversion",
};

/**
 * Returns the topic-exclusion key for this goal, or null if the goal has
 * no meaningful topic opt-out. Callers should branch on null (skip the
 * filter / skip the guardrail check).
 */
export function getTopicExclusionKey(goal: NurtureGoal): string | null {
  return TOPIC_EXCLUSION_KEYS_BY_GOAL[goal] ?? null;
}
