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
};

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
    "Reading an uploaded plan set: splitting it into sheets, classifying them and indexing the title blocks. Not built yet — the switch is here first so it is not retrofitted later.",
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
