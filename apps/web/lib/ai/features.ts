import type { AiFeature } from "@prova/db";
// NOT FROM THE BARREL, AND THIS FILE HAS ALREADY PAID FOR THAT ONCE.
// Twenty-nine test files mock "@prova/integrations" PARTIALLY, so any export
// reached through the barrel must exist in every one of their factories or the
// test dies on an access it never asked about — which is how importing
// `modelFor` took eight stream tests red in one run. `models.ts` is pure: no
// SDK client, no database, no side effect at import.
import type { AiFeatureKey } from "@prova/integrations/src/models";

/**
 * The AI switch's vocabulary: what the features are called, what they do, and
 * the refusal sentence for one that is off.
 *
 * WHY THIS IS A SEPARATE FILE FROM `settings.ts`, AND IT IS NOT TIDINESS. The
 * settings form is a client component, `settings.ts` imports `prisma`, and
 * `client-prisma-boundary.test.ts` fails the build when a `"use client"` module
 * can reach `PrismaClient` — which it caught within a minute of the form being
 * written. Bundling a database client into the browser is the defect; a screen
 * needing the LABELS is not a reason to send it the QUERIES.
 *
 * So: everything here is pure data and pure functions, safe on either side of
 * the boundary. `settings.ts` is the half that reads a row, and imports this.
 *
 * `type AiFeature` from `@prova/db` is a TYPE-ONLY import and is erased at
 * compile time, so it carries no client and does not cross the boundary.
 */

/** What a company's settings say, with the defaults an absent row means. */
export type AiSettings = {
  aiEnabled: boolean;
  disabledFeatures: AiFeature[];
  planSheetsPerMonth: number;
  addendumPagesPerMonth: number;
  specPagesPerMonth: number;
  modelOverride: string | null;
};

/**
 * The defaults an absent row stands for.
 *
 * ABSENT IS NOT OFF. Every company has no row on the day this ships, and a
 * product that stops working after a deploy — with nothing on screen saying why
 * — is worse than one with a switch nobody has touched. So a missing row means
 * on, every feature enabled, the included allowance.
 *
 * 1,500 sheets is Diego's figure for the $399 plan: five 300-sheet sets a
 * month. Whether it is sustainable is a question about measured cost, and the
 * answer comes from step 2's real numbers rather than from this constant.
 */
export const AI_SETTINGS_DEFAULTS: AiSettings = {
  aiEnabled: true,
  disabledFeatures: [],
  planSheetsPerMonth: 1500,
  addendumPagesPerMonth: 600,
  // 1,800 is Diego's figure, and it was 600 for about an hour until the page
  // estimate behind it turned out to be wrong — a spec section is thirty-odd
  // pages, not ten, so 600 was three bids a month rather than fifteen.
  // `ask-allowance.prisma` carries the arithmetic.
  specPagesPerMonth: 1800,
  modelOverride: null,
};

/** `PLAN_INGESTION` etc. — the schema enum member for a feature key. */
export function aiFeatureEnum(feature: AiFeatureKey): AiFeature {
  return feature as AiFeature;
}

/**
 * What to call each feature on screen.
 *
 * A total `Record` over the feature keys, so adding a feature without giving it
 * a name does not compile — the shape #526 landed for `CostCategory` after a
 * missing member produced a NaN bid total. A raw key like
 * `DRAFT_ESTIMATE_LINES` in a refusal sentence is the kind of thing a person
 * reads as a bug.
 */
export const AI_FEATURE_LABEL: Record<AiFeatureKey, string> = {
  ASK: "The assistant",
  WIP_NARRATIVE: "The WIP narrative",
  COMPLIANCE_EXTRACT: "Reading compliance documents",
  DRAFT_ESTIMATE_LINES: "Drafting estimate lines",
  BID_RESEARCH: "Bid research",
  LEAD_SEARCH: "Lead search",
  QUOTE_EXTRACT: "Reading a sub's quote",
  PLAN_INGESTION: "Reading plan sets",
  ADDENDUM_READ: "Reading addenda",
  SPEC_READ: "Reading spec sections",
  SCHEDULE_READ: "Reading schedules off a drawing",
  PROPOSAL_DRAFT: "Drafting proposal clauses",
};

/**
 * The on-screen name for a feature as the USAGE LEDGER spells it.
 *
 * ── THIS EXISTS BECAUSE THE TWO HALVES OF THE APP SPELL A FEATURE
 *    DIFFERENTLY, AND A LOOKUP THAT NEVER MATCHED SHIPPED ──
 *
 * `AiFeatureKey` is SCREAMING_SNAKE (`PLAN_INGESTION`) because it is a
 * TypeScript union and a settings column. `AskUsage.feature` is kebab
 * (`plan-ingestion`) because it is a ledger string — see `AskUsageFeature` in
 * `lib/ask/usage.ts`. Both spellings are deliberate and neither is changing.
 *
 * The cost panel shipped on 2026-10-02 reading `AI_FEATURE_LABEL[row.feature]`
 * with the ledger's spelling, which is `undefined` for EVERY feature, and fell
 * through to a `?? feature` fallback — so every row on a money screen rendered
 * its raw database key. Found by clicking it, not by any test. Two things of
 * mine hid it, and both looked like care at the time:
 *
 *   - an `as keyof typeof` cast, which silenced the one type error that would
 *     have caught it at compile time;
 *   - the fallback itself, written so an unnamed feature would not be DROPPED,
 *     which turned a total failure into something that reads as a rare edge
 *     case.
 *
 * So the mapping is DERIVED rather than written out a second time — a hand-kept
 * second list is the defect #526 collapsed (a completeness guard cannot see a
 * consumer that stopped reading the canonical list). The transform is
 * mechanical, and `askFeatureLabelCensus.test.ts` asserts every member of
 * `AskUsageFeature` resolves to a real label, so the fallback can never again
 * be the normal path.
 */
export function askFeatureLabel(ledgerFeature: string): string {
  const key = ledgerFeature.toUpperCase().replace(/-/g, "_") as AiFeatureKey;
  // The fallback is kept, and is now genuinely for the unknown case only: a
  // tenth caller that writes a ledger row before anybody names it appears under
  // its own key rather than vanishing from a bill. The census is what makes
  // that a rare case rather than every case.
  return AI_FEATURE_LABEL[key] ?? ledgerFeature;
}

/**
 * What each feature actually DOES, in one line, for the settings screen.
 *
 * Not decoration. An owner deciding whether to switch something off needs to
 * know what stops working, and "Reading compliance documents" does not tell
 * them that filing a lien waiver stops with it. A switch somebody flips without
 * knowing what it costs them is how a support call starts.
 *
 * Total `Record` for the same reason as the labels: a feature with no
 * explanation does not compile.
 */
export const AI_FEATURE_DESCRIPTION: Record<AiFeatureKey, string> = {
  ASK: "The Ask box: questions about your own jobs, and the cards it puts in front of you.",
  WIP_NARRATIVE:
    "The plain-language reading of a job's WIP figures on the Estimate tab. The figures themselves are computed in code and do not use AI.",
  COMPLIANCE_EXTRACT:
    "Reading an uploaded lien waiver, COI or certified payroll into its fields. Filing a compliance document needs this — with it off, uploads are refused rather than filed blank.",
  DRAFT_ESTIMATE_LINES: "Turning a pasted scope of work into draft line items for you to price and correct.",
  BID_RESEARCH:
    "Looking up a new project on the web to pre-fill a bid card. The project name and location leave for the search.",
  LEAD_SEARCH: "Searching the web for projects out to bid in your trades and area.",
  QUOTE_EXTRACT:
    "Reading a quote a sub or supplier sent you, and filling in the amount, date and exclusions for you to check. Nothing is saved until you press save, and with this off you can still type a quote in by hand.",
  PLAN_INGESTION:
    "Reading an uploaded plan set: per sheet, whether it has selectable text and what its title block says, proposed as a sheet index you confirm or correct. With this off, sheets are still labelled by typing them in.",
  ADDENDUM_READ:
    "Reading an addendum a GC issued on a bid, and listing what it says it changed for you to check against the document. It never decides whether something affects work you have already priced — that stays your tick on the addendum — and with this off you can still log addenda by hand.",
  SPEC_READ:
    "Reading a spec section from the bid documents and listing what in it costs money — finish levels, rated assemblies, mock-ups, testing, named products — for you to check against your number. It never says whether your bid already carries a cost, because it has not seen your estimate. With this off you read the section yourself, as you do today.",
  SCHEDULE_READ:
    "Reading a door, window, finish or partition schedule off a drawing into rows you accept or reject. The rows are proposed, never added to a takeoff on their own — and with this off you can still type a schedule in by hand.",
  PROPOSAL_DRAFT:
    "Writing the inclusions, exclusions and clarifications for a job's proposal \u2014 one per thing this app already knows about the bid: a spec requirement, an indirect nobody priced, a package carried from a sub. Every clause is proposed with the quote it came from, and nothing reaches the proposal until you accept it. With this off you can still write clauses by hand.",
};

/**
 * Every feature key, for a settings screen to iterate.
 *
 * DERIVED FROM THE LABEL MAP ABOVE, not from `AI_FEATURES` in
 * `@prova/integrations`, and that is not a style choice. A dozen tests mock
 * that package PARTIALLY, and an import-time `Object.keys` of an export a mock
 * left out throws while the module is still loading — which takes down every
 * file that transitively imports this one, with a stack that points at that
 * line rather than at the mock. `lib/ask/leadFinder.ts` carries the same
 * warning about the same package for the same reason, and this fired within a
 * minute of being written the other way.
 *
 * The label map is a total `Record<AiFeatureKey, string>`, so it cannot be
 * missing a feature without failing typecheck — the list is exactly as
 * complete as reading the enum would be, and it is local.
 */
export const AI_FEATURE_KEYS = Object.keys(AI_FEATURE_LABEL) as AiFeatureKey[];

/**
 * The refusal for a feature that is switched off, or null when it may run.
 *
 * RETURNS A SENTENCE, NEVER THROWS. Production redacts a thrown Server Action
 * message to a digest, so a thrown refusal here would reach the person as the
 * error boundary — "something went wrong" on a feature somebody deliberately
 * turned off, which is the most confusing possible outcome. Same rule the rest
 * of `lib/actions` follows.
 *
 * The message names WHO can change it, because a person meeting this has no
 * other way to find out: the switch is owner-only and lives on a settings page
 * they may not be able to open.
 */
export function aiFeatureRefusal(settings: AiSettings, feature: AiFeatureKey): string | null {
  if (!settings.aiEnabled) {
    return "AI is switched off for your company. The account owner can turn it back on under Settings → Assistant.";
  }
  if (settings.disabledFeatures.includes(aiFeatureEnum(feature))) {
    return `${AI_FEATURE_LABEL[feature]} is switched off for your company. The account owner can turn it back on under Settings → Assistant.`;
  }
  return null;
}
