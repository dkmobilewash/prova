import { readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * ── A PLAN SET READ FROM THIS MACHINE, FOR REVIEWING CONFIDENTIAL DRAWINGS ──
 *
 * Plan bytes normally come from the blob store: a file is uploaded from the
 * browser and every later read fetches it back. That is right for a customer's
 * own set, and it is wrong for the one job this exists for — building an
 * ANSWER KEY against a client's issued drawings, on a developer's laptop.
 *
 * Those sheets are confidential. Uploading them would put them in shared
 * storage that preview deployments can reach, which is the blob-store half of
 * the rule CLAUDE.md states for the database: browser testing must not write
 * real things. So for this, the bytes stay on the machine and never move.
 *
 * ── THE GATE, AND WHY EACH HALF OF IT IS THERE ──
 *
 * 1. `TAKEOFF_LOCAL_PLAN_DIR` must be set. Unset — which is every deployment —
 *    and this returns null before looking at anything.
 * 2. A production build refuses unless ALL FOUR conditions below hold. A
 *    server that can be told to read its own filesystem by a value in the
 *    database is the shape of a file-disclosure bug, and the only thing
 *    standing between those two states is an environment variable somebody
 *    could set by accident.
 * 3. The resolved path must sit INSIDE the configured directory. `..` is
 *    resolved first and the result compared by prefix, so a crafted `fileUrl`
 *    cannot climb out of it.
 *
 * ── WHY A PRODUCTION BUILD IS NO LONGER AN OUTRIGHT NO ──
 *
 * It was, and that made the protected labelling mode impossible: `next start`
 * always sets `NODE_ENV=production`, so the no-recompile server this
 * programme runs on could never serve a `local:` plan. On 2026-10-20 every
 * one of eighteen sheets opened to "That drawing couldn't be opened" — the
 * page rendering, the scale showing, no drawing — while the session that had
 * switched to that mode reported all of them loading, because it was checking
 * that the PAGE rendered rather than that the DRAWING did.
 *
 * The fix is not to drop the refusal but to name what a deployment can never
 * satisfy. All four, each asked separately:
 *
 *   a. `TAKEOFF_LOCAL_PLAN_DIR` is set and absolute, as for a dev build.
 *   b. `ALLOW_LOCAL_PLANS=1` — an opt-in that exists for nothing else, set by
 *      `dev-local-plans.sh` and by no deployment.
 *   c. the server is bound to LOOPBACK. `HOSTNAME` drives both this check and
 *      the `-H` that `next start` binds, so the two cannot disagree: a server
 *      reachable from the network fails this whatever else is set.
 *   d. no `VERCEL` variable AT ALL — not `VERCEL === "1"`. Any value means a
 *      Vercel runtime, and this has no business running on one.
 *
 * A real deployment fails (b), (c) and (d) independently. The path-escape
 * check is unchanged and applies in every mode.
 *
 * It does NOT touch `isBlobStorageUrl`. That guard is what stops the server
 * fetching an arbitrary address a caller once chose, and weakening it to make
 * a local workflow convenient would be trading a real protection for a
 * convenience. This is a separate scheme that the blob path never sees.
 */

/** The scheme a local plan is recorded under: `local:Camp Bow Wow.pdf`. */
export const LOCAL_PLAN_SCHEME = "local:";

export type LocalPlanProblem = { ok: false; error: string };
export type LocalPlanBytes = { ok: true; bytes: Buffer };

/**
 * The hostnames that mean "this machine only".
 *
 * `0.0.0.0` is deliberately absent: it is every interface, which is the one
 * case this check exists to refuse.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Whether a PRODUCTION build may read local plan files.
 *
 * Exported for its own test. Each condition is asked separately so a test can
 * remove one at a time and watch the whole thing refuse — a gate tested only
 * as a whole is a gate where three of four conditions could be dead.
 */
export function productionLocalPlansAllowed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return productionLocalPlansRefusal(env) === null;
}

/**
 * WHICH condition refuses, as a name, or null when all four hold.
 *
 * ── A REFUSAL THAT SAYS NOTHING COSTS AN AFTERNOON ──
 *
 * The browser is told "That drawing could not be read", which is right — a
 * server filesystem path has no business in a page. But the SERVER said
 * nothing either, so a refusal and a missing file and a path escape all
 * looked identical from outside, and the only way to tell them apart was to
 * guess at four environment variables that `ps` on macOS will not show you.
 *
 * Names only, never values: these are not secrets, and the names are what a
 * person needs to fix it.
 */
export function productionLocalPlansRefusal(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  // Any VERCEL variable at all, not just "1".
  if (env.VERCEL !== undefined) return "VERCEL is set — local plans never run on Vercel";
  if (env.ALLOW_LOCAL_PLANS !== "1") return "ALLOW_LOCAL_PLANS is not exactly \"1\"";
  const bind = (env.HOSTNAME ?? "").trim().toLowerCase();
  if (!LOOPBACK.has(bind)) {
    return `HOSTNAME is ${bind === "" ? "unset" : `"${bind}"`}, not loopback`;
  }
  const dir = env.TAKEOFF_LOCAL_PLAN_DIR ?? "";
  if (dir === "") return "TAKEOFF_LOCAL_PLAN_DIR is unset";
  if (!isAbsolute(dir)) return "TAKEOFF_LOCAL_PLAN_DIR is not an absolute path";
  return null;
}

/** Said once per cold start, not once per request. */
let saidWhy = false;

/** Whether a stored `fileUrl` is asking for a file on this machine. */
export function isLocalPlanUrl(fileUrl: string): boolean {
  return fileUrl.startsWith(LOCAL_PLAN_SCHEME);
}

/**
 * Where a local plan URL resolves to, or null when it must not be read.
 *
 * Exported for its own test: the refusals are the whole value here, and a path
 * check nobody can exercise is a path check nobody has verified.
 */
export function localPlanPath(fileUrl: string, env: NodeJS.ProcessEnv): string | null {
  if (!isLocalPlanUrl(fileUrl)) return null;
  // Never on Vercel, in any mode, whatever else is configured.
  if (env.VERCEL !== undefined) return null;
  // A production build reads from disk only under the four conditions above.
  if (env.NODE_ENV === "production") {
    const why = productionLocalPlansRefusal(env);
    if (why !== null) {
      if (!saidWhy) {
        saidWhy = true;
        // eslint-disable-next-line no-console
        console.warn(`[local-plans] refusing to read plan files: ${why}`);
      }
      return null;
    }
  }
  const dir = env.TAKEOFF_LOCAL_PLAN_DIR ?? "";
  if (dir === "" || !isAbsolute(dir)) return null;

  const asked = fileUrl.slice(LOCAL_PLAN_SCHEME.length);
  if (asked === "") return null;
  // An absolute path in the URL is refused rather than honoured: the directory
  // is the whole of the permission, and a value that ignores it is not asking
  // for a file in it.
  if (isAbsolute(asked)) return null;

  const root = resolve(dir);
  const full = resolve(root, asked);
  // Prefix comparison WITH the separator, so `/plans-secret` cannot pass as a
  // child of `/plans`.
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export async function readLocalPlan(
  fileUrl: string,
  env: NodeJS.ProcessEnv,
): Promise<LocalPlanBytes | LocalPlanProblem> {
  const path = localPlanPath(fileUrl, env);
  if (path === null) {
    return {
      ok: false,
      error: "That plan is recorded as a file on this machine, which this server cannot read.",
    };
  }
  try {
    return { ok: true, bytes: await readFile(path) };
  } catch {
    // The path is NOT in the message. It is a server filesystem path and the
    // reader is a browser; naming it would be the disclosure this guard exists
    // to prevent.
    return { ok: false, error: "That plan file is not where it was when it was added." };
  }
}
