import { prisma } from "@prova/db";
import { pushToUser } from "@/lib/push";
import type { AgentSettings, NewFinding } from "./core";

/**
 * Telling people an agent found something. IN-APP ONLY — no email, ever.
 *
 * What exists and what was used:
 *   - The open-findings count on /ai (`openFindingCount` in queries.ts) is
 *     the in-app notice; it needs nothing from here.
 *   - `pushToUser` (lib/push.ts) is the generic phone push the alert digest
 *     already rides: it reaches the person's own registered devices and
 *     sends nothing anywhere else. Used for warn/flag findings only — an
 *     "info" (a new invitation) is not worth buzzing a phone over.
 *   - NOT used: `dispatchAlertDigest` (email) and `dispatchAlertPush`, which
 *     is bound to the alert engine's milestone ledger, not a generic notice.
 *
 * One push per person per run, and only for findings that were NEW this run
 * (the caller passes only those dedupe let through), so a bid still due on
 * Friday buzzes once, not daily. The push carries no deep-link target: the
 * phone app routes only /alerts and /job/..., and an unknown target just
 * opens the app.
 *
 * Never throws. A push that fails must not turn a run whose findings are
 * already written into a FAILED run.
 */
export type NotifyReport = { recipients: number; sent: number; skipped: number };

export async function notifyFindings(
  companyId: string,
  findings: NewFinding[],
  settings: Pick<AgentSettings, "notifyUserIds">,
): Promise<NotifyReport> {
  const urgent = findings.filter((f) => f.severity !== "info");
  if (urgent.length === 0) return { recipients: 0, sent: 0, skipped: 0 };
  try {
    // notifyUserIds is filtered to THIS company's users here as well as on
    // save: a person who left the company keeps their id in the list.
    const users = await prisma.user.findMany({
      where: settings.notifyUserIds.length
        ? { companyId, id: { in: settings.notifyUserIds } }
        : { companyId, role: "OWNER" },
      select: { id: true },
    });
    const title = urgent.length === 1 ? urgent[0].title : `${urgent.length} things on your bids need a look`;
    const body = urgent.length === 1 ? urgent[0].body : urgent.slice(0, 3).map((f) => f.title).join(" · ");
    let sent = 0;
    for (const u of users) {
      if ((await pushToUser(u.id, title, body)) === "sent") sent++;
    }
    return { recipients: users.length, sent, skipped: users.length - sent };
  } catch (error) {
    console.error("[agents] notify failed", { companyId }, error);
    return { recipients: 0, sent: 0, skipped: 0 };
  }
}
