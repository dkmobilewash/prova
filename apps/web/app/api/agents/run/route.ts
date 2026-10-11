import crypto from "node:crypto";
import { prisma, type AgentKind } from "@prova/db";
import "@/lib/agents/all";
import { runAgent } from "@/lib/agents/run";

/**
 * The scheduled agent run: the bid watcher, daily, for every company that
 * has it on (or has never saved agent settings — absent means default ON).
 *
 * NOT protected by Clerk — see the note in middleware.ts. A scheduler has no
 * session. It authenticates the request itself with a timing-safe check of
 * `Authorization: Bearer $CRON_SECRET`, copied from
 * /api/notifications/digest, and FAILS CLOSED with 503 when the secret is
 * unset: unset must mean the schedule does not work, never that it works
 * for anyone who knows the URL.
 *
 * A GET with side effects because Vercel Cron issues GET only. It is safe
 * to repeat: every watcher finding carries a dedupeKey, so a second GET a
 * second later writes run rows and no repeated findings.
 *
 * `?agent=RECOMMENDATIONS` runs that agent the same way. Nothing else:
 * BID_RESEARCH and ESTIMATE_CHECK run on an event or a person's press, and
 * a URL must not be able to start model runs across every company.
 *
 * Every per-company gate (AI switch, agent switch, spend cap) is runAgent's,
 * so a paused or skipped company still leaves a run row saying why.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Below maxDuration so the run stops itself and reports, rather than being
 *  killed mid-company with no body. Same figure as the digest's. */
const RUN_BUDGET_MS = 45_000;

const CRON_AGENTS = {
  BID_WATCHER: "watcherEnabled",
  RECOMMENDATIONS: "recommendationsEnabled",
} as const satisfies Partial<Record<AgentKind, string>>;
type CronAgent = keyof typeof CRON_AGENTS;

function authorized(request: Request, secret: string): boolean {
  const offered = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return offered.length === expected.length && crypto.timingSafeEqual(offered, expected);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  if (!authorized(request, secret)) return new Response("Unauthorized", { status: 401 });

  const asked = new URL(request.url).searchParams.get("agent") ?? "BID_WATCHER";
  if (!Object.hasOwn(CRON_AGENTS, asked)) {
    return json({ ok: false, error: `${asked} does not run on a schedule` }, 400);
  }
  const agent = asked as CronAgent;
  const toggle = CRON_AGENTS[agent];

  const companies = await prisma.company.findMany({
    where: { OR: [{ agentSettings: null }, { agentSettings: { [toggle]: true } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const started = Date.now();
  const counts = { companies: companies.length, ran: 0, paused: 0, skipped: 0, failed: 0, notAttempted: 0 };
  for (const { id } of companies) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      counts.notAttempted++;
      continue;
    }
    try {
      const outcome = await runAgent({ companyId: id, agent, trigger: "cron" });
      if (outcome.ran) counts.ran++;
      else if (outcome.status === "PAUSED_CAP") counts.paused++;
      else if (outcome.status === "SKIPPED") counts.skipped++;
      else counts.failed++;
    } catch (error) {
      // runAgent catches the runner; this is the gate or the run row itself
      // failing. One company's failure must not stop the rest.
      console.error("[agents] cron run threw", { companyId: id, agent }, error);
      counts.failed++;
    }
  }

  console.log(
    `[agents] cron ${agent} companies=${counts.companies} ran=${counts.ran} paused=${counts.paused} skipped=${counts.skipped} failed=${counts.failed} not-attempted=${counts.notAttempted}`,
  );
  // Same rule as the digest: the status answers "did this run do its whole
  // job". A run that failed a company or ran out of time is not a 200.
  const clean = counts.failed === 0 && counts.notAttempted === 0;
  return json({ ok: clean, agent, ...counts }, clean ? 200 : 500);
}
