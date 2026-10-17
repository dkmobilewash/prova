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
 * 2. A production build refuses outright, whatever the variable says. A server
 *    that can be told to read its own filesystem by a value in the database is
 *    the shape of a file-disclosure bug, and the only thing standing between
 *    those two states is an environment variable somebody could set by
 *    accident.
 * 3. The resolved path must sit INSIDE the configured directory. `..` is
 *    resolved first and the result compared by prefix, so a crafted `fileUrl`
 *    cannot climb out of it.
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
  // A production build never reads from disk, whatever is configured.
  if (env.NODE_ENV === "production" || env.VERCEL === "1") return null;
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
