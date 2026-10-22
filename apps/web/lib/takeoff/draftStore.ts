import { DRAFT_FORMAT, draftKey, type ReviewDraft } from "./reviewDraft";

/**
 * ── THE BROWSER HALF OF THE DRAFT ──
 *
 * `reviewDraft.ts` decides what a draft IS and whether one may be restored;
 * this talks to `localStorage` and nothing else, so the deciding stays
 * testable without a browser.
 *
 * ── EVERY CALL IS WRAPPED, AND THAT IS NOT DEFENSIVE HABIT ──
 *
 * `localStorage` throws rather than returning null in a private window, with
 * site data blocked, and when the origin's quota is full — and a quota error
 * is the likely one here, because a sheet with 49 traces is not small. The
 * whole point of this file is that a reviewer does not lose work; a draft
 * that cannot be written must not take the review down with it.
 */

/** Whether the browser will let us store anything at all. */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(draft: ReviewDraft): boolean {
  const where = store();
  if (where === null) return false;
  try {
    where.setItem(draftKey(draft.set, draft.page, draft.finderVersion), JSON.stringify(draft));
    return true;
  } catch {
    // Out of quota, most likely. Reported as false so a caller can tell the
    // reviewer their work is not being kept, rather than implying it is.
    return false;
  }
}

export function loadDraft(set: string, page: number, finderVersion: string): ReviewDraft | null {
  const where = store();
  if (where === null) return null;
  try {
    const raw = where.getItem(draftKey(set, page, finderVersion));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as ReviewDraft;
    // A shape check before anything downstream trusts it: this came out of a
    // store that another version of this screen also writes to.
    if (parsed.format !== DRAFT_FORMAT) return null;
    if (typeof parsed.fingerprint !== "string" || typeof parsed.verdicts !== "object") return null;
    if (!Array.isArray(parsed.traced)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(set: string, page: number, finderVersion: string): void {
  const where = store();
  if (where === null) return;
  try {
    where.removeItem(draftKey(set, page, finderVersion));
  } catch {
    // Nothing to do and nothing to say: the draft is stale, not dangerous.
  }
}

/**
 * Drafts left by OTHER finder builds for this sheet.
 *
 * A build change makes a draft unrestorable — the ids it is keyed by no
 * longer mean the same walls — but the reviewer should be told one exists
 * rather than have an afternoon's work disappear silently when the server is
 * rebuilt under them.
 */
export function otherDrafts(set: string, page: number, finderVersion: string): ReviewDraft[] {
  const where = store();
  if (where === null) return [];
  const prefix = `takeoff-review-draft:${set}:${page}:`;
  const mine = draftKey(set, page, finderVersion);
  const out: ReviewDraft[] = [];
  try {
    for (let i = 0; i < where.length; i += 1) {
      const key = where.key(i);
      if (key === null || !key.startsWith(prefix) || key === mine) continue;
      const raw = where.getItem(key);
      if (raw === null) continue;
      const parsed = JSON.parse(raw) as ReviewDraft;
      if (parsed.format === DRAFT_FORMAT) out.push(parsed);
    }
  } catch {
    return out;
  }
  return out;
}
