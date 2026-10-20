import { mkdir, readFile, writeFile } from "node:fs/promises";
import { productionLocalPlansRefusal } from "./localPlanFile";
import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * ── WHERE A REVIEWED SHEET'S LABELS GO, AND WHY NOT INTO THE DATABASE ──
 *
 * A reviewed sheet is training data: the feature vector of every candidate the
 * finder produced, with the reviewer's verdict on it. That is the bottleneck
 * for the whole hybrid plan — synthetic training was measured and lost, so
 * real labelled sheets are the only way forward.
 *
 * It is written to a folder on this machine rather than to the database or to
 * blob storage, for the same reason the plans themselves are read from one:
 * **these are a client's issued drawings**. A feature vector is twenty-four
 * numbers and cannot reconstruct a drawing, but the file names a sheet in a
 * client's set, and that is enough to keep it off shared storage.
 *
 * ── THE GATE, WHICH IS `localPlanFile.ts`'s, FOR ITS REASONS ──
 *
 * 1. `TAKEOFF_LABEL_DIR` must be set. Unset — which is every deployment — and
 *    this refuses before touching anything.
 * 2. A production build refuses outright whatever the variable says. A server
 *    that can be told to write to its own filesystem by a value in a request
 *    is the shape of a file-write bug, and an environment variable is one
 *    accident away from being set.
 * 3. The resolved path must sit INSIDE the configured directory, with `..`
 *    resolved first and the result compared by prefix, so a crafted sheet name
 *    cannot climb out of it.
 */
export const LABEL_DIR_VAR = "TAKEOFF_LABEL_DIR";

export type LabelWriteProblem = { ok: false; error: string };
export type LabelWritten = { ok: true; path: string };

/** Anything that is not a letter, digit, dash, dot or underscore becomes one
 *  underscore. Applied to both the set and the sheet, so neither can contain a
 *  separator and neither can be `..`. */
function safeName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned === "" ? "unnamed" : cleaned.slice(0, 120);
}

/** Said once per cold start, not once per save. */
let saidWhy = false;

/**
 * Where a label file resolves to, or null when it must not be written.
 *
 * Exported for its own test: the refusals are the whole value here, and a path
 * that is never checked is a path that is wrong on the day it matters.
 */
export function labelPath(
  set: string,
  sheet: string,
  env: NodeJS.ProcessEnv,
): string | null {
  // ── THE SAME OPT-IN AS LOCAL PLAN FILES, FOR THE SAME REASON ──
  //
  // `next start` always sets NODE_ENV=production, so a flat refusal here made
  // the no-recompile labelling server unable to SAVE — which is worse than
  // being unable to load, because the reviewer finds out after doing the
  // sheet. On 2026-10-20 a finished sheet sat in an open tab with nowhere to
  // go: "Labels are not being saved: TAKEOFF_LABEL_DIR is not set, or this is
  // a production build."
  //
  // The conditions are `localPlanFile.ts`'s, imported rather than restated —
  // two copies of a security gate is how one of them quietly stops matching
  // the other. A real deployment fails the opt-in, the loopback bind and the
  // Vercel test independently, so it still refuses.
  if (env.NODE_ENV === "production") {
    const why = productionLocalPlansRefusal(env);
    if (why !== null) {
      if (!saidWhy) {
        saidWhy = true;
        // eslint-disable-next-line no-console
        console.warn(`[local-labels] refusing to write label files: ${why}`);
      }
      return null;
    }
  }
  const dir = env[LABEL_DIR_VAR];
  if (dir === undefined || dir.trim() === "") return null;
  const root = resolve(dir.trim());
  if (!isAbsolute(root)) return null;
  const full = resolve(join(root, safeName(set), `${safeName(sheet)}.json`));
  // Prefix comparison with the separator appended, so `/labels-other` cannot
  // pass as being inside `/labels`.
  //
  // UNREACHABLE TODAY and kept anyway: `safeName` has already removed every
  // separator and leading dot, so `full` is always one level inside `root`.
  // Mutating this line leaves the tests green, which is recorded here rather
  // than papered over with a contrived case — it guards the day `safeName`
  // is relaxed, which is exactly when nobody will be looking at this line.
  if (full !== root && !full.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  return full;
}

/** Writes one sheet's labels, creating the set's folder. */
/**
 * Reads a sheet's saved labels, or null when there are none.
 *
 * Exists so a save can see what it is about to replace. Camp Bow Wow A101's
 * 143 verdicts were overwritten by a 15-verdict second pass with no warning,
 * because nothing on this path ever looked at the file it was writing over.
 *
 * Deliberately forgiving: an unreadable or malformed file reads as "nothing
 * there", because this informs a guard rather than being one. A reviewer
 * whose save is refused by a parse error has lost the sheet just as surely.
 */
export async function readLabels(
  set: string,
  sheet: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ verdicts?: unknown[]; rows?: unknown[] } | null> {
  const path = labelPath(set, sheet, env);
  if (path === null) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as { verdicts?: unknown[] };
  } catch {
    return null;
  }
}

export async function writeLabels(
  set: string,
  sheet: string,
  body: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LabelWritten | LabelWriteProblem> {
  const path = labelPath(set, sheet, env);
  if (path === null) {
    return {
      ok: false,
      error:
        `Labels are not being saved: ${LABEL_DIR_VAR} is not set, or this is a ` +
        `production build. Nothing was written.`,
    };
  }
  try {
    await mkdir(path.slice(0, path.lastIndexOf(sep)), { recursive: true });
    await writeFile(path, `${JSON.stringify(body, null, 1)}\n`, "utf8");
    return { ok: true, path };
  } catch (cause) {
    return { ok: false, error: `Could not write ${path}: ${String(cause)}` };
  }
}
