/**
 * What the person is looking at when they ask.
 *
 * A coworker standing next to you does not ask which job you mean. They can
 * see the screen. The assistant is mounted in the Topbar and is therefore on
 * every page in the app, and until now it knew nothing about which one — so
 * standing on Riverside's job page and saying "log 8 hours for Tino today"
 * made it resolve a job from scratch, or ask.
 *
 * THIS IS A HINT, NEVER AN AUTHORITY, and that distinction is the whole
 * security design of this file. The path arrives in the request body from a
 * browser, so it is exactly as trustworthy as anything else a caller can
 * type. `/api/ask`'s header comment used to promise that nothing was read
 * from the body but the question; that promise is now amended rather than
 * quietly broken, and this is what makes the amendment safe:
 *
 *   1. this module PARSES a path into an id and nothing more — it reads no
 *      rows and can grant no access;
 *   2. the id is then looked up through the caller's own company scope, so
 *      a path naming another company's job resolves to nothing at all,
 *      which is byte-identical to sending no path;
 *   3. nothing here can widen what the assistant may read. The read tools
 *      and commands were already company-scoped and still are. The worst a
 *      forged path can do is make the assistant guess the wrong default for
 *      a job the caller can already see.
 *
 * So the failure mode of a hostile path is "the assistant assumed the wrong
 * one of YOUR jobs", not "the assistant read somebody else's".
 */

/** A page that is about one identifiable thing. */
export type PageHint = { kind: "job"; id: string };

/** Ids in this app are cuids — `cuid()` from Prisma. Matching the shape
 * rather than accepting any string keeps a path segment from becoming a
 * free-text search term downstream, and means a malformed path is rejected
 * here rather than turning into a database round trip that finds nothing. */
const ID = /^[a-z0-9]{20,32}$/;

/**
 * Turn a route into the thing it is about, or null.
 *
 * Deliberately narrow: `/jobs/<id>` and everything nested under it, because
 * that is where the work happens and every child route (certified payroll,
 * the photo report, a pay application) is still about that job. Everything
 * else returns null and the assistant behaves exactly as it did before.
 *
 * `/jobs` on its own is NOT a hint — it is a list, and "this job" on a list
 * of five jobs means nothing.
 */
export function parsePageContext(path: string | null | undefined): PageHint | null {
  if (!path) return null;

  // Query strings and fragments are not part of the route, and a trailing
  // slash is the same page. Strip before splitting so `/jobs/x/?tab=costs`
  // and `/jobs/x` are one answer rather than two.
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);

  if (parts[0] !== "jobs") return null;
  const id = parts[1];
  if (!id || !ID.test(id)) return null;

  return { kind: "job", id };
}

/**
 * The sentence the model is given about where the person is standing.
 *
 * Written as a fact plus a rule, not as an instruction to prefer this job:
 * the person may well be asking about a different one, and a model told to
 * "use this job" will bend an explicit "on Cedar Park" towards the page it
 * is on. Naming a job in the question has to keep winning, so the rule is
 * scoped to the case where they named none.
 */
export function pageContextSentence(job: { name: string } | null): string | null {
  if (!job) return null;
  return (
    `The person is looking at the job "${job.name}" right now. ` +
    `If they say "this job", or ask something that needs a job and name none, they mean that one. ` +
    `If they name a different job, that one wins — do not substitute the page they happen to be on.`
  );
}
