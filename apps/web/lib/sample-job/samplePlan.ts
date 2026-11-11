import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * ── THE SAMPLE SET: A DRAWING SHIPPED WITH THE APP ──
 *
 * A sample job's plan is `sample:<name>`, read from the deployment's own files,
 * never from the blob store: one copy serves every company, nothing is uploaded,
 * and deleting one company's sample cannot delete anybody else's file.
 *
 * INVENTED, NEVER A CLIENT'S. The sheets are the generated takeoff fixtures
 * (`lib/takeoff/fixtures/generator`), whose title block prints "SYNTHETIC
 * FIXTURE · NOT A REAL PROJECT". A real set (Baker and the rest) is a client's
 * drawing and is never shown to another company.
 *
 * The file is read by path, so `next.config.mjs` names it in
 * `outputFileTracingIncludes`, or a deploy ships no file.
 */
export const SAMPLE_PLAN_SCHEME = "sample:";

export type SamplePlan = {
  /** The fixture's file under lib/takeoff/fixtures/plans. */
  file: string;
  title: string;
  sheet: string;
  /** Page width in points and feet per paper inch: the scale is set from what the sheet prints. */
  widthPt: number;
  feetPerInch: number;
  scaleText: string;
};

/** The allowlist: a `sample:` URL naming anything else reads nothing. */
export const SAMPLE_PLANS = {
  office: { file: "S13.pdf", title: "Professional office suite", sheet: "A-101", widthPt: 1728, feetPerInch: 8, scaleText: '1/8" = 1\'-0"' },
} as const satisfies Record<string, SamplePlan>;
export type SamplePlanKey = keyof typeof SAMPLE_PLANS;
export const SAMPLE_PLAN_KEY: SamplePlanKey = "office";

/** Said when a stage that uses plan sheets is started on the sample set, which never uses one. */
export const SAMPLE_READS_NOTHING =
  "This is the sample set: it is already read, and reading it again would use your plan sheets. Upload your own plans to try plan reading.";

export function samplePlanUrl(key: SamplePlanKey): string {
  return `${SAMPLE_PLAN_SCHEME}${key}`;
}

export function isSamplePlanUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(SAMPLE_PLAN_SCHEME);
}

export function samplePlanFor(url: string): SamplePlan | null {
  if (!isSamplePlanUrl(url)) return null;
  const key = url.slice(SAMPLE_PLAN_SCHEME.length);
  return Object.prototype.hasOwnProperty.call(SAMPLE_PLANS, key) ? SAMPLE_PLANS[key as SamplePlanKey] : null;
}

/** The sheet's width in feet, from its printed scale: points ÷ 72 = paper inches. */
export function sheetWidthFeet(plan: SamplePlan): number {
  return (plan.widthPt / 72) * plan.feetPerInch;
}

/**
 * Locally `next start` runs in apps/web; on Vercel the function runs at the
 * repo root (why TAKEOFF_WALL_MODEL reads `apps/web/models/…`). Both are tried.
 */
const PLAN_DIRS = ["lib/takeoff/fixtures/plans", "apps/web/lib/takeoff/fixtures/plans"];

export async function readSamplePlan(url: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const plan = samplePlanFor(url);
  if (plan === null) return { ok: false, error: "That sample drawing is not one C Stream ships." };
  for (const dir of PLAN_DIRS) {
    try {
      return { ok: true, bytes: await readFile(path.join(process.cwd(), dir, plan.file)) };
    } catch {
      // the next place
    }
  }
  console.error("[sample-job] the sample drawing is missing from this deployment", { url, cwd: process.cwd() });
  return { ok: false, error: "The sample drawing is missing from this deployment." };
}
