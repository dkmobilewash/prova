import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jobStages, type JobStageInput } from "@/components/job/jobStages";

/**
 * journey.ts's JOB_TAB_STAGE says which stage box on a job (Concept G,
 * 2026-10-10) files each tab, so `openJobTab` can open the right stage
 * before clicking. It is a COPY of what components/job/jobStages.ts decides,
 * because journey.ts loads @playwright/test and cannot be imported here.
 *
 * A copy drifts. This derives the same map from `jobStages()` itself — a
 * bid and a contracted job, every door open — and fails when the two
 * disagree, naming the tab. Read as text, like health.test.ts reads
 * health.ts, and for the same reason.
 */
const journeySource = readFileSync(path.join(__dirname, "journey.ts"), "utf8");

function mapInSource(): Record<string, string> {
  const block = journeySource.match(/export const JOB_TAB_STAGE: Record<string, JobStageKey> = \{([\s\S]*?)\n\};/);
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/^\s*(?:"([^"]+)"|([A-Za-z]+)):\s*"(estimate|contract|crew|billing|closeout)",?\s*$/gm)) {
    out[m[1] ?? m[2]] = m[3];
  }
  return out;
}

const base: JobStageInput = {
  jobId: "job-1",
  status: "IN_PROGRESS",
  lifecycleStage: "in_progress",
  showsJobMoney: true,
  showsBilling: true,
  showsField: true,
  canReachPunchList: true,
  canReachCloseout: true,
  crewSize: 1,
  contractSigned: true,
  approvedChangeOrders: 0,
  invoiceCount: 0,
  latestPayApp: null,
  asOf: new Date("2026-10-12T00:00:00.000Z"),
};

function mapFromStages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of [base, { ...base, status: "ESTIMATE", lifecycleStage: "bidding" as const, contractSigned: false }]) {
    for (const stage of jobStages(input)) {
      for (const link of stage.links) {
        expect(out[link.label] ?? stage.key, `"${link.label}" is filed under two stages`).toBe(stage.key);
        out[link.label] = stage.key;
      }
    }
  }
  return out;
}

describe("the e2e helpers' copy of which stage holds each job tab", () => {
  const copied = mapInSource();
  const derived = mapFromStages();

  it("was actually parsed out of journey.ts (a check about an empty map proves nothing)", () => {
    expect(Object.keys(copied).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(derived).length).toBeGreaterThanOrEqual(10);
  });

  it("matches what jobStages() decides, tab for tab", () => {
    expect(copied).toEqual(derived);
  });
});
