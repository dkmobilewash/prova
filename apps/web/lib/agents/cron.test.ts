import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WATCHER_CRON_PATH, WATCHER_CRON_SCHEDULE } from "./queries";

/**
 * The schedule that runs the watcher, pinned at the file Vercel reads.
 *
 * Hobby allows TWO cron jobs on `prova-web`, and a production deploy that
 * declares a third is refused outright — which is how the watcher came to
 * ride the digest's entry (lib/agents/cron.ts) instead of its own. Nothing
 * here can read the plan, so the count is pinned at two: a third entry fails
 * on a laptop in a second rather than on the deploy after merge.
 *
 * The second half is the census half: the entry /ai calls "next run" must
 * be one vercel.json actually declares, AND the route behind it must
 * actually call the watcher — a schedule pointing at a route that forgot to
 * is the "written, documented, never called" shape wearing a cron.
 */
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

describe("vercel.json's cron list", () => {
  it("holds at most the two entries Hobby allows, and does not schedule /api/agents/run on its own", () => {
    expect(vercel.crons.length).toBeLessThanOrEqual(2);
    expect(vercel.crons.map((c) => c.path)).not.toContain("/api/agents/run");
  });

  it("schedules the entry /ai names as the watcher's next run", () => {
    expect(vercel.crons).toContainEqual({ path: WATCHER_CRON_PATH, schedule: WATCHER_CRON_SCHEDULE });
  });

  it("and the route behind that entry calls the watcher", () => {
    const routeFile = new URL(`../../app${WATCHER_CRON_PATH}/route.ts`, import.meta.url);
    const source = readFileSync(routeFile, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(source).toMatch(/runScheduledAgent\(\{\s*agent:\s*"BID_WATCHER"/);
    expect(source).toContain("scheduledRunClean(agents)");
  });
});
