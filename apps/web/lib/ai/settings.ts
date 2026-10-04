import { prisma } from "@prova/db";
// See `features.ts` for why this is the module path and not the barrel.
import { modelFor, type AiFeatureKey, type ModelChoice } from "@prova/integrations/src/models";
import { AI_SETTINGS_DEFAULTS, aiFeatureRefusal, type AiSettings } from "./features";

/**
 * The per-company AI switch, read before any model call.
 *
 * WHY THIS EXISTS. Nothing in this app could turn AI off for one company. The
 * gates were, in order: a SERVER-WIDE `ANTHROPIC_API_KEY`, per-person
 * capabilities, courtesy rate limits, and a paid allowance — so the only way to
 * stop the assistant for one customer was to stop it for everybody. A
 * contractor who wants their drawings kept away from a model had no answer.
 *
 * THE GATE IS IN THE APP, NOT IN THE PACKAGE, and that is deliberate.
 * `packages/integrations` is DB-free on purpose — it takes a `ModelUsageReporter`
 * callback rather than importing prisma — so it cannot read a company's
 * settings and must not learn how. Every model call therefore passes through
 * `aiGate` on the app side first, and `aiFeatureGateCensus.test.ts` is what
 * makes that true rather than intended.
 *
 * THE SERVER HALF. This file reads a row, so it imports `prisma` and therefore
 * cannot be imported by a client component — `client-prisma-boundary.test.ts`
 * fails the build over it. Everything a screen needs (labels, descriptions, the
 * refusal sentence) is in `./features.ts`, which touches no database and is
 * re-exported below so a server caller still has one import.
 */

export {
  AI_FEATURE_DESCRIPTION,
  AI_FEATURE_KEYS,
  AI_FEATURE_LABEL,
  AI_SETTINGS_DEFAULTS,
  aiFeatureEnum,
  aiFeatureRefusal,
  type AiSettings,
} from "./features";

/** One company's settings, or the defaults when it has no row. */
export async function aiSettingsFor(companyId: string): Promise<AiSettings> {
  const row = await prisma.companyAiSettings.findUnique({
    where: { companyId },
    select: {
      aiEnabled: true,
      disabledFeatures: true,
      planSheetsPerMonth: true,
      addendumPagesPerMonth: true,
      specPagesPerMonth: true,
      modelOverride: true,
    },
  });
  return row ?? AI_SETTINGS_DEFAULTS;
}

/** What a caller that got through the gate has: permission, and the model. */
export type AiPass = {
  ok: true;
  settings: AiSettings;
  /**
   * The model id to hand to the integration, already resolved against this
   * company's override.
   *
   * THE GATE RESOLVES IT so the call site names its feature ONCE. Returning
   * only `settings` would leave every caller writing `modelFor("X",
   * gate.settings.modelOverride)` beside `aiGate(companyId, "X")` — the same
   * key twice, and a copy-paste that gates one feature while pricing another
   * is a mistake nothing here could catch.
   */
  model: string;
  /** Where the id came from, for the log line. */
  modelSource: ModelChoice["source"];
};

/**
 * Read the settings and decide in one call — what a call site actually wants.
 *
 * Every model call in this app starts here. The refusal is a sentence to
 * return, and a pass carries the model so no caller has to resolve one.
 */
export async function aiGate(
  companyId: string,
  feature: AiFeatureKey,
): Promise<AiPass | { ok: false; error: string }> {
  let settings: AiSettings;
  try {
    settings = await aiSettingsFor(companyId);
  } catch {
    // IT FAILS CLOSED, and that is the opposite of the courtesy rate limit
    // next door, which fails OPEN on purpose (#257). The two are different
    // kinds of promise. A rate limit exists to be polite about load, so
    // refusing a person because a COUNTER would not read is worse than
    // letting them through. This switch exists because a contractor said
    // their drawings must not reach a model — and a switch that opens when
    // it cannot read itself has not kept that promise, it has just kept it
    // most of the time.
    //
    // It costs nothing real: every caller of this is inside a request that
    // has already read the database several times, so a read that fails here
    // is a request that was going to fail anyway.
    //
    // A SENTENCE, NOT A RETHROW. Production redacts a thrown Server Action
    // message to a digest, so rethrowing would put "something went wrong" on
    // screen. Metadata only in the log — a company id and a feature, never a
    // question, a document, a file name or the error's own text, which can
    // carry a connection string.
    console.error("[ai] settings unreadable, refusing", { companyId, feature });
    return {
      ok: false,
      error:
        "AI is unavailable right now — your company's AI settings couldn't be read, so nothing was sent to a model. Try again in a minute.",
    };
  }
  const refusal = aiFeatureRefusal(settings, feature);
  if (refusal) return { ok: false, error: refusal };
  const choice = modelFor(feature, settings.modelOverride);
  return { ok: true, settings, model: choice.model, modelSource: choice.source };
}
