# @rello-platform/nurture-goals

Canonical NurtureGoal registry and agent-facing priming metadata for the Rello platform. Single source of truth consumed by Rello (campaigns: `Campaign.goalKey`, `CampaignGoal` seed, `Campaign.primingFacts` validation) and Milo Engine (goal-driven framework selection, outcome weights).

## What lives here

- **`NurtureGoal`** — the 10-value union identifying why Milo is nurturing a given lead (HOME_PURCHASE, REFINANCE, REVERSE_MORTGAGE, EQUITY_ACCESS, REACTIVATION, RELATIONSHIP, REFERRAL, HOME_SALE, LISTING_CONVERSION, BRAND_AWARENESS).
- **`NURTURE_GOAL_METADATA`** — platform-level display data (displayName, description, sortOrder) used to seed Rello's `CampaignGoal` table. Per-tenant override is a future `CampaignGoalTenantSetting` table, not this file.
- **`PRIMING_CATEGORIES_BY_GOAL`** — agent priming-facts category registry. Every goal gets 6 universal categories (thesis, audience_note, lean_into, steer_clear, frame, cta) plus 1–3 goal-specific categories. Priming follows the AboutMe pattern (see Lead-Cohort-Campaign spec B-03) — per-entry `{ text, category }`, 280-char cap, at least one required per required category before launch.
- **`TOPIC_EXCLUSION_KEYS_BY_GOAL`** — maps each goal to its `Lead.leadTopicExclusions` key, so an opted-out lead is skipped at cohort-resolve and blocked mid-flight. RELATIONSHIP and BRAND_AWARENESS are intentionally omitted.
- **Helpers** — `isNurtureGoal`, `isPrimingCategoryKey`, `isValidPrimingCategoryForGoal`, `getRequiredPrimingCategoryKeys`, `getPrimingCategoriesForGoal`, `getTopicExclusionKey`.
- **`inferNurtureGoal`** (v0.3.0) — pure function `(NurtureGoalInferenceInput) => NurtureGoal | null` covering lead-state goal inference (Harvest Home intent-type routing + post-sale + COLD-engagement fallthrough + reactivation triggers). Returns `null` for structurally non-goal-shift signals (`appraisal_concern`, `email_complained`, `agent_action.*`, `deal_distress.*`, `compliance.*`) so callers can short-circuit without writing precedence-authority audit rows. Consumed by Milo Engine's `resolveNurtureGoalRaw` wrapper and Rello's signal-driven precedence-authority connector.

## Coordination with Milo Engine

Milo's `NurtureGoal` type in `Milo-Engine/src/lib/nurture-goals.ts` must match this list exactly. As of v0.1.0 (2026-04-21) the lists are identical by hand-verification; Phase 4 of the Lead-Cohort-Campaign build replaces Milo's local type with an import from this package, removing the need for manual sync.

**Changing the list here is a coordinated cross-repo migration** — don't add or rename a goal without updating Milo's framework rule paths (`Milo-Engine/src/lib/frameworks.ts`) and outcome weights (`Milo-Engine/src/lib/nurture-goals.ts` GOAL_OUTCOME_WEIGHTS) in the same release.

## Versioning

- `0.6.0` — **06142026-NURTURE-AUDIT P3 (HYBRID).** Adds the `INVESTOR` goal (DSCR / investment-property; slow-to-medium portfolio-minded cadence) — `inferNurtureGoal` now routes `hh_intent_type=INVEST`, `pfp_loan_purpose=DSCR/investor`, and the PFP DSCR-advisor markers (`dscr_intent_type` / `dscr_loan_purpose`) to `INVESTOR` (was `HOME_PURCHASE` in v0.5.0). Adds the `loanProgram` SECONDARY dimension (`LoanProgram` union: `VA_PURCHASE | VA_IRRRL | FHA_PURCHASE | FHA_STREAMLINE | FHA_CASHOUT | CONVENTIONAL | DSCR`) + `inferLoanProgram` (derives from `pfp_is_veteran` / `pfp_eligible_programs` / `pfp_loan_purpose` / `dscr_*` / `Transaction.loanType`) + `inferNurtureContext` (returns `{ goal, loanProgram }`). The dimension steers Milo's framework emphasis + composition program-specific hooks (VA IRRRL / FHA Streamline / DSCR); it does NOT change goal selection except DSCR/investor → `INVESTOR`. `null` loanProgram = no hook fires (no behavior change). Coordinated Milo bump in the same release.
- `0.5.0` — `inferNurtureGoal` reads `pfp_loan_purpose` as a SECONDARY goal-inference source (HH `hh_intent_type` still wins): purchase→HOME_PURCHASE, refi→REFINANCE, cash-out→EQUITY_ACCESS, reverse/HECM→REVERSE_MORTGAGE. 06142026-NURTURE-AUDIT P1.
- `0.3.0` — adds `inferNurtureGoal(input: NurtureGoalInferenceInput): NurtureGoal | null`. Logic ported verbatim from Milo Engine's `resolveNurtureGoalRaw` lead-state inference (sans REALTOR_PROSPECT short-circuit, which stays in Milo's outer wrapper to preserve role-narrowing semantics). Signal-aware non-goal-shift filter returns `null` for `appraisal_concern`, `email_complained`, `email_unsubscribed`, `email_bounced`, and any `agent_action.*` / `deal_distress.*` / `compliance.*` prefix. Per NURTURE-PRECEDENCE-AUTHORITY-SPEC-260520 Hole 1 amendment + DECISIONS-260519 D2-CORRECTED.
- `0.2.0` — REALTOR_CULTIVATION goal added (REALTOR-PROSPECT-PIPELINE D21).
- `0.1.0` — initial publish; 10-goal registry, priming categories, topic-exclusion map. Consumed by Rello's Phase 1 schema + seed (campaigns feature, 2026-04-21).

Follow the same `github:rello-platform/nurture-goals#vX.Y.Z` tag-based consumption model as `@rello-platform/slugs`.
