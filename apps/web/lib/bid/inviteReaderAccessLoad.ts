import { anthropicIsConfigured } from "@prova/integrations";
import { aiFeatureRefusal, aiSettingsFor } from "@/lib/ai/settings";
import { inviteReaderAccess, type InviteReaderAccess } from "./inviteReaderAccess";

/**
 * The server half of `inviteReaderAccess.ts`, shaped exactly like the ask box's
 * `loadBidAskAccess`: read the two facts, let the pure function decide. The
 * switch is `BID_RESEARCH`, the one `readBidInvitationText` runs behind.
 *
 * A settings read that fails does not draw the refusal — the action fails
 * CLOSED on that same read when somebody presses, and says so in a sentence;
 * hiding the paste box over a blip would only hide it on a load that would
 * have worked.
 */
export async function loadInviteReaderAccess(companyId: string): Promise<InviteReaderAccess> {
  let refusal: string | null = null;
  try {
    refusal = aiFeatureRefusal(await aiSettingsFor(companyId), "BID_RESEARCH");
  } catch {
    refusal = null;
  }
  return inviteReaderAccess({ configured: anthropicIsConfigured(), refusal });
}
