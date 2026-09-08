/**
 * What counts as the same tag, and what counts as a usable one.
 *
 * Pure and session-free, the same split as lib/job-media.ts against its
 * query module: the rule is decidable here and testable without a
 * database, and every writer imports it rather than restating it. There is
 * exactly one `normalizeTagName` and both the create path and the
 * attach-existing path go through it — a second copy is how `LOCATION_TYPES`
 * came to disagree with its own Prisma enum (CLAUDE.md).
 */

/** Long enough for "north stairwell, 3rd floor landing", short enough that
 * a pasted paragraph is refused rather than becoming a tag. */
export const JOB_MEDIA_TAG_MAX_LENGTH = 60;

/** How many tags one photo may carry.
 *
 * A cap rather than none, because the tag row is what makes retrieval
 * work and a photo wearing forty labels is not tagged, it is decorated —
 * every one of those tags then matches a search that should not have
 * returned this photo. Generous enough that nobody hits it honestly. */
export const JOB_MEDIA_TAGS_PER_PHOTO_MAX = 12;

/**
 * The form a tag is COMPARED in — never the form it is displayed in.
 *
 * WHY THIS EXISTS. Without it "West Wall", "west wall" and "West wall" are
 * three separate tags. The autocomplete offers all three, three people
 * pick differently, and the photos of one wall end up split across them —
 * at which point tagging has made retrieval WORSE than not tagging, because
 * a search that returns two thirds of the photos reads as if it returned
 * all of them.
 *
 * The steps, and why each one:
 *   - NFKC first, so that characters which are the same letter in
 *     different encodings fold together before anything else looks at
 *     them. A phone keyboard and a desktop keyboard do not always produce
 *     the same bytes for the same visible word.
 *   - lower case, the obvious one.
 *   - collapse ALL runs of whitespace to one space, so "west  wall" and a
 *     tab-separated paste both land on "west wall".
 *   - trim the ends.
 *
 * What it deliberately does NOT do: strip punctuation or accents.
 * "RFI-14" and "RFI 14" are plausibly different references on a real job,
 * and folding them would merge two things a person meant to keep apart —
 * the opposite failure to the one above and a harder one to notice.
 */
export function normalizeTagName(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The form a tag is STORED and SHOWN in: what the person typed, with only
 * the whitespace tidied. "West Wall" stays "West Wall"; lower-casing it
 * for storage would quietly rewrite "RFI-14" and "3F" too. */
export function displayTagName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export type TagNameProblem = "empty" | "too-long";

/**
 * Why this tag cannot be used, or null if it can.
 *
 * Judged on the NORMALIZED form, because that is what uniqueness and
 * matching are judged on — a name that is only whitespace is empty however
 * much whitespace it is, and a 60-character limit that a run of double
 * spaces could sneak past is not a limit.
 */
export function tagNameProblem(raw: string): TagNameProblem | null {
  const normalized = normalizeTagName(raw);
  if (!normalized) return "empty";
  if (normalized.length > JOB_MEDIA_TAG_MAX_LENGTH) return "too-long";
  return null;
}

/** The sentence shown to the person, for each way a tag can be refused.
 * Here rather than at the call sites so the wording cannot drift between
 * the two actions that can hit it. */
export function tagNameProblemMessage(problem: TagNameProblem): string {
  switch (problem) {
    case "empty":
      return "A tag needs some text in it";
    case "too-long":
      return `Tags are at most ${JOB_MEDIA_TAG_MAX_LENGTH} characters — that one is longer`;
  }
}

/**
 * Splits what somebody typed into distinct tags.
 *
 * Comma-separated, because that is what a person does unprompted when a
 * field says "tags" and it costs nothing to accept. Deduplicated on the
 * NORMALIZED form so "West Wall, west wall" is one tag rather than a
 * unique-constraint collision inside a single submit — the same folding
 * the database will apply, applied before the database has to.
 *
 * Returns display forms, in first-seen order, so the person gets the
 * casing they typed rather than the casing of whichever duplicate the
 * comparison happened to keep.
 */
export function parseTagInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const normalized = normalizeTagName(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(displayTagName(part));
  }
  return out;
}
