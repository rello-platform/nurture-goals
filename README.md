# @rello-platform/nurture-goals

Canonical NurtureGoal registry and agent-facing priming metadata for the Rello platform. Single source of truth consumed by Rello (campaigns: `Campaign.goalKey`, `CampaignGoal` seed, `Campaign.primingFacts` validation) and Milo Engine (goal-driven framework selection, outcome weights).

## What lives here

- **`NurtureGoal`** — the 10-value union identifying why Milo is nurturing a given lead (HOME_PURCHASE, REFINANCE, REVERSE_MORTGAGE, EQUITY_ACCESS, REACTIVATION, RELATIONSHIP, REFERRAL, HOME_SALE, LISTING_CONVERSION, BRAND_AWARENESS).
- **`NURTURE_GOAL_METADATA`** — platform-level display data (displayName, description, sortOrder) used to seed Rello's `CampaignGoal` table. Per-tenant override is a future `CampaignGoalTenantSetting` table, not this file.
- **`PRIMING_CATEGORIES_BY_GOAL`** — agent priming-facts category registry. Every goal gets 6 universal categories (thesis, audience_note, lean_into, steer_clear, frame, cta) plus 1–3 goal-specific categories. Priming follows the AboutMe pattern (see Lead-Cohort-Campaign spec B-03) — per-entry `{ text, category }`, 280-char cap, at least one required per required category before launch.
- **`TOPIC_EXCLUSION_KEYS_BY_GOAL`** — maps each goal to its `Lead.leadTopicExclusions` key, so an opted-out lead is skipped at cohort-resolve and blocked mid-flight. RELATIONSHIP and BRAND_AWARENESS are intentionally omitted.
- **Helpers** — `isNurtureGoal`, `isPrimingCategoryKey`, `isValidPrimingCategoryForGoal`, `getRequiredPrimingCategoryKeys`, `getPrimingCategoriesForGoal`, `getTopicExclusionKey`.

## Coordination with Milo Engine

Milo's `NurtureGoal` type in `Milo-Engine/src/lib/nurture-goals.ts` must match this list exactly. As of v0.1.0 (2026-04-21) the lists are identical by hand-verification; Phase 4 of the Lead-Cohort-Campaign build replaces Milo's local type with an import from this package, removing the need for manual sync.

**Changing the list here is a coordinated cross-repo migration** — don't add or rename a goal without updating Milo's framework rule paths (`Milo-Engine/src/lib/frameworks.ts`) and outcome weights (`Milo-Engine/src/lib/nurture-goals.ts` GOAL_OUTCOME_WEIGHTS) in the same release.

## Versioning

- `0.1.0` — initial publish; 10-goal registry, priming categories, topic-exclusion map. Consumed by Rello's Phase 1 schema + seed (campaigns feature, 2026-04-21).

Follow the same `github:rello-platform/nurture-goals#vX.Y.Z` tag-based consumption model as `@rello-platform/slugs`.
