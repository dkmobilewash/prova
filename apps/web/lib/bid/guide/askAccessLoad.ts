import { anthropicIsConfigured } from "@prova/integrations";
import { aiFeatureRefusal, aiSettingsFor } from "@/lib/ai/settings";
import type { Principal } from "@/lib/permissions";
import { commandsForSurface } from "@/lib/ask/surface";
import { bidAskAccess, type BidAskAccess } from "./askAccess";

/**
 * The server half of `askAccess.ts`: read the facts, let the pure function
 * decide. Reads the company's AI settings — the same row `aiGate` reads — but
 * not through `aiGate`, because nothing here calls a model: this only decides
 * what the box SAYS. The question itself goes through `aiGate` in
 * `streamAnswer`, as every model call does.
 *
 * A settings read that fails does not draw the refusal. The server fails
 * CLOSED on that same read when a question is asked (lib/ai/settings.ts), and
 * says so in a sentence; drawing a dead box over a blip would only hide the
 * box on a page load that would have worked.
 */
export async function loadBidAskAccess(companyId: string, principal: Principal): Promise<BidAskAccess> {
  let refusal: string | null = null;
  try {
    refusal = aiFeatureRefusal(await aiSettingsFor(companyId), "ASK");
  } catch {
    refusal = null;
  }
  return bidAskAccess({
    configured: anthropicIsConfigured(),
    refusal,
    canChange: commandsForSurface(principal, "bid").length > 0,
  });
}
