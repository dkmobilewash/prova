import { prisma } from "@prova/db";
import { sendExpoPush } from "@prova/integrations";

/** Push a notification to every device a user has registered. Best-effort:
 * an empty device list, a missing Expo token, or a provider failure are each
 * reported distinctly rather than thrown, so a push can never take down the
 * action that triggered it. */
export async function pushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<"no-devices" | "unconfigured" | "sent" | "failed"> {
  const tokens = await prisma.deviceToken.findMany({ where: { userId }, select: { expoToken: true } });
  if (tokens.length === 0) return "no-devices";

  const result = await sendExpoPush(tokens.map((t) => ({ to: t.expoToken, title, body, data })));
  if (!result.ok) return result.configured ? "failed" : "unconfigured";
  return "sent";
}
