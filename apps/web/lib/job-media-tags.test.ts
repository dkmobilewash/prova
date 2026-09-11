import { describe as group, expect, it } from "vitest";
import {
  JOB_MEDIA_TAGS_PER_PHOTO_MAX,
  JOB_MEDIA_TAG_MAX_LENGTH,
  displayTagName,
  normalizeTagName,
  parseLocatedFilter,
  parseSharedFilter,
  parseTagInput,
  photosFilterHref,
  tagCapProblemMessage,
  tagNameProblem,
  tagNameProblemMessage,
} from "./job-media-tags";

/**
 * What counts as the same tag.
 *
 * This is the whole feature's load-bearing decision and it is decidable
 * without a database, which is why it is a pure module with this file
 * against it. Get it wrong in the lenient direction and "West Wall", "west
 * wall" and "West  wall" become three tags that split one wall's photos
 * three ways — a search that returns a third of the photos reads exactly
 * like one that returned all of them. Get it wrong in the aggressive
 * direction and "RFI-14" merges with "RFI 14", which is the same failure
 * with the damage done to a pair of things somebody meant to keep apart.
 *
 * So the cases below are written in both directions on purpose: as many
 * assertions about what does NOT fold as about what does.
 */

group("normalizeTagName folds what must be the same tag", () => {
  it("folds case, which is the obvious one", () => {
    expect(normalizeTagName("West Wall")).toBe("west wall");
    expect(normalizeTagName("WEST WALL")).toBe("west wall");
    expect(normalizeTagName("west wall")).toBe("west wall");
    expect(normalizeTagName("wEsT wAlL")).toBe("west wall");
  });

  it("collapses every run of whitespace to one space", () => {
    // A double space is what a thumb on a phone keyboard produces; a tab is
    // what a paste out of a spreadsheet produces. Neither is a different tag.
    expect(normalizeTagName("west  wall")).toBe("west wall");
    expect(normalizeTagName("west\twall")).toBe("west wall");
    expect(normalizeTagName("west\nwall")).toBe("west wall");
    expect(normalizeTagName("west   \t  wall")).toBe("west wall");
  });

  it("trims the ends, including after collapsing", () => {
    expect(normalizeTagName("  west wall  ")).toBe("west wall");
    expect(normalizeTagName("\twest wall\n")).toBe("west wall");
  });

  it("applies NFKC, so the same word typed on two keyboards is one tag", () => {
    // Fullwidth Latin — what an IME produces, and visually the same word.
    expect(normalizeTagName("ＷＥＳＴ ＷＡＬＬ")).toBe("west wall");
    // The fi ligature, which some PDF and word-processor pastes carry.
    expect(normalizeTagName("ﬁre rated")).toBe("fire rated");
    // A decomposed accent (e + combining acute) and the precomposed
    // character are the same letter, and NFKC composes them. Without this
    // step the two are different strings, so the same word typed on a Mac
    // and on a phone would be two tags.
    expect(normalizeTagName("café")).toBe(normalizeTagName("café"));
    // Compatibility digits: "①" is a 1 as far as NFKC is concerned.
    expect(normalizeTagName("Level ①")).toBe("level 1");
  });

  it("is idempotent — normalising a normalised name changes nothing", () => {
    // Relied on by the write path, which normalises the person's text and
    // then compares it against a column that was normalised on the way in.
    for (const raw of ["West Wall", "  RFI-14 ", "ＷＥＳＴ", "café", "3F  landing"]) {
      const once = normalizeTagName(raw);
      expect(normalizeTagName(once)).toBe(once);
    }
  });
});

group("normalizeTagName keeps apart what somebody meant to keep apart", () => {
  it("does NOT strip punctuation", () => {
    // "RFI-14" and "RFI 14" are plausibly two different references on a real
    // job. Folding them merges two things deliberately kept apart, and that
    // is the harder failure to notice — nothing looks wrong, there are just
    // photos of the wrong thing under the label.
    expect(normalizeTagName("RFI-14")).not.toBe(normalizeTagName("RFI 14"));
    expect(normalizeTagName("RFI-14")).toBe("rfi-14");
    expect(normalizeTagName("before/after")).toBe("before/after");
    expect(normalizeTagName("3rd fl.")).toBe("3rd fl.");
  });

  it("does NOT fold accents away", () => {
    // NFKC composes an accent onto its letter; it does not remove it. So
    // "café" and "cafe" stay two tags, which is right — they are two words.
    expect(normalizeTagName("café")).not.toBe(normalizeTagName("cafe"));
    expect(normalizeTagName("café")).toBe("café");
  });

  it("does not merge two words into one by removing the space", () => {
    expect(normalizeTagName("west wall")).not.toBe(normalizeTagName("westwall"));
  });

  it("keeps digits and letters that only look alike as they were typed", () => {
    expect(normalizeTagName("3F")).toBe("3f");
    expect(normalizeTagName("3F")).not.toBe(normalizeTagName("3E"));
  });
});

group("displayTagName is what a person sees", () => {
  it("keeps the casing the person typed", () => {
    // The reason there are two functions at all. Lower-casing for storage
    // would quietly rewrite "RFI-14" and "3F" on screen.
    expect(displayTagName("West Wall")).toBe("West Wall");
    expect(displayTagName("RFI-14")).toBe("RFI-14");
    expect(displayTagName("3F")).toBe("3F");
  });

  it("still tidies whitespace, so nothing renders with a double space in it", () => {
    expect(displayTagName("  West   Wall ")).toBe("West Wall");
    expect(displayTagName("West\tWall")).toBe("West Wall");
  });

  it("normalises encoding, so two spellings of one word render identically", () => {
    expect(displayTagName("ＷＥＳＴ")).toBe("WEST");
    expect(displayTagName("café")).toBe("café");
  });

  it("agrees with normalizeTagName on everything except case", () => {
    for (const raw of ["  West   Wall ", "RFI-14", "3F landing", "ＷＥＳＴ"]) {
      expect(displayTagName(raw).toLowerCase()).toBe(normalizeTagName(raw));
    }
  });
});

group("tagNameProblem refuses what cannot be a tag", () => {
  it("calls an empty name empty, however much whitespace it is", () => {
    expect(tagNameProblem("")).toBe("empty");
    expect(tagNameProblem("   ")).toBe("empty");
    expect(tagNameProblem("\t\n ")).toBe("empty");
  });

  it("accepts a name at exactly the limit and refuses one past it", () => {
    expect(tagNameProblem("a".repeat(JOB_MEDIA_TAG_MAX_LENGTH))).toBeNull();
    expect(tagNameProblem("a".repeat(JOB_MEDIA_TAG_MAX_LENGTH + 1))).toBe("too-long");
  });

  it("measures the NORMALISED length, not the typed one", () => {
    // A limit a run of double spaces can sneak past is not a limit. The
    // string here is over the cap as typed and under it once collapsed, and
    // the collapsed form is what gets stored, so it is allowed.
    const padded = `${"a".repeat(JOB_MEDIA_TAG_MAX_LENGTH - 2)}     b`;
    expect(padded.length).toBeGreaterThan(JOB_MEDIA_TAG_MAX_LENGTH);
    expect(normalizeTagName(padded).length).toBe(JOB_MEDIA_TAG_MAX_LENGTH);
    expect(tagNameProblem(padded)).toBeNull();

    // And trailing whitespace never makes a legal name illegal.
    expect(tagNameProblem(`${"a".repeat(JOB_MEDIA_TAG_MAX_LENGTH)}   `)).toBeNull();
  });

  it("accepts the names this feature exists for", () => {
    for (const name of ["west wall", "West Wall", "3rd floor", "before pour", "RFI-14", "damage"]) {
      expect(tagNameProblem(name)).toBeNull();
    }
  });
});

group("tagNameProblemMessage says something a person can act on", () => {
  it("has a sentence for every problem the type allows", () => {
    // Exhaustive by construction: if a third problem is ever added, the
    // switch stops compiling and this list stops being complete, which is
    // the point of listing them here rather than testing one.
    expect(tagNameProblemMessage("empty")).toMatch(/text/i);
    expect(tagNameProblemMessage("too-long")).toContain(String(JOB_MEDIA_TAG_MAX_LENGTH));
  });
});

group("parseTagInput splits what somebody typed", () => {
  it("takes a single tag with no comma in it", () => {
    expect(parseTagInput("west wall")).toEqual(["west wall"]);
  });

  it("splits on commas and trims each part", () => {
    expect(parseTagInput("west wall, 3rd floor,before pour")).toEqual([
      "west wall",
      "3rd floor",
      "before pour",
    ]);
  });

  it("dedupes on the NORMALISED form, keeping the first casing typed", () => {
    // The case this exists for. Without it, one submit carries two rows
    // that collide on @@unique([companyId, normalizedName]) — a 500 caused
    // by nothing worse than typing the same thing twice.
    expect(parseTagInput("West Wall, west wall")).toEqual(["West Wall"]);
    expect(parseTagInput("west wall, WEST WALL, West  Wall")).toEqual(["west wall"]);
  });

  it("drops empty parts rather than making a tag out of a stray comma", () => {
    expect(parseTagInput("west wall,")).toEqual(["west wall"]);
    expect(parseTagInput(",,west wall,,  ,")).toEqual(["west wall"]);
    expect(parseTagInput("")).toEqual([]);
    expect(parseTagInput("  ,  ")).toEqual([]);
  });

  it("returns display forms, so the person gets the casing back", () => {
    expect(parseTagInput("  West   Wall  ")).toEqual(["West Wall"]);
    expect(parseTagInput("RFI-14")).toEqual(["RFI-14"]);
  });

  it("keeps two names that only differ by punctuation as two tags", () => {
    expect(parseTagInput("RFI-14, RFI 14")).toEqual(["RFI-14", "RFI 14"]);
  });
});

group("tagCapProblemMessage caps a photo's tags", () => {
  it("allows a photo up to exactly the cap", () => {
    expect(tagCapProblemMessage(0, 1)).toBeNull();
    expect(tagCapProblemMessage(0, JOB_MEDIA_TAGS_PER_PHOTO_MAX)).toBeNull();
    expect(tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX - 1, 1)).toBeNull();
  });

  it("refuses the one that would go past it", () => {
    expect(tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX, 1)).not.toBeNull();
    expect(tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX - 1, 2)).not.toBeNull();
    expect(tagCapProblemMessage(0, JOB_MEDIA_TAGS_PER_PHOTO_MAX + 1)).not.toBeNull();
  });

  it("says both numbers, so the person knows how many to drop", () => {
    const message = tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX, 3) as string;
    expect(message).toContain(String(JOB_MEDIA_TAGS_PER_PHOTO_MAX));
    expect(message).toContain("3 more");
    expect(tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX, 1)).toContain("one more");
  });

  it("adding nothing is never over the cap, even on a full photo", () => {
    // Re-submitting tags a photo already carries adds none of them, and
    // must not be refused for a cap it is not moving.
    expect(tagCapProblemMessage(JOB_MEDIA_TAGS_PER_PHOTO_MAX, 0)).toBeNull();
  });
});

group("parseSharedFilter admits exactly two values", () => {
  it("takes the two that mean something", () => {
    expect(parseSharedFilter("yes")).toBe("yes");
    expect(parseSharedFilter("no")).toBe("no");
  });

  it("treats everything else as no filter at all", () => {
    // Not as one half of one. An unrecognised value must not quietly pick a
    // side: `?shared=true` silently meaning "yes" would hide half the
    // gallery from somebody who thinks they are looking at all of it, and
    // `?shared=false` silently meaning "yes" would show the GC-facing set to
    // somebody checking the opposite.
    expect(parseSharedFilter("true")).toBeNull();
    expect(parseSharedFilter("false")).toBeNull();
    expect(parseSharedFilter("1")).toBeNull();
    expect(parseSharedFilter("0")).toBeNull();
    expect(parseSharedFilter("YES")).toBeNull();
    expect(parseSharedFilter("shared")).toBeNull();
    expect(parseSharedFilter("")).toBeNull();
    expect(parseSharedFilter(undefined)).toBeNull();
    expect(parseSharedFilter(null)).toBeNull();
  });
});

group("parseLocatedFilter admits exactly two values", () => {
  it("takes the two that mean something", () => {
    expect(parseLocatedFilter("yes")).toBe("yes");
    expect(parseLocatedFilter("no")).toBe("no");
  });

  it("falls back to no filter for anything else", () => {
    // Same posture as every other filter on this page: an unrecognised
    // value must not produce a gallery that is quietly withholding captures
    // with nothing on the page to say so.
    expect(parseLocatedFilter("true")).toBeNull();
    expect(parseLocatedFilter("false")).toBeNull();
    expect(parseLocatedFilter("gps")).toBeNull();
    expect(parseLocatedFilter("YES")).toBeNull();
    expect(parseLocatedFilter("")).toBeNull();
    expect(parseLocatedFilter(undefined)).toBeNull();
    expect(parseLocatedFilter(null)).toBeNull();
  });
});

group("photosFilterHref composes the gallery's four filters", () => {
  it("is the bare gallery when nothing is filtered", () => {
    expect(photosFilterHref({})).toBe("/photos");
    expect(photosFilterHref({ job: null, tag: null })).toBe("/photos");
    expect(photosFilterHref({ job: "", tag: "" })).toBe("/photos");
  });

  it("carries either filter on its own", () => {
    expect(photosFilterHref({ job: "job_1" })).toBe("/photos?job=job_1");
    expect(photosFilterHref({ tag: "tag_1" })).toBe("/photos?tag=tag_1");
  });

  it("carries BOTH, which is the requirement", () => {
    // Job AND tag. The bug this guards against is a chip that drops the
    // other filter — the page then shows more photos than the person asked
    // for and looks entirely healthy doing it.
    expect(photosFilterHref({ job: "job_1", tag: "tag_1" })).toBe("/photos?job=job_1&tag=tag_1");
  });

  it("clearing one filter keeps the other", () => {
    expect(photosFilterHref({ job: "job_1", tag: null })).toBe("/photos?job=job_1");
    expect(photosFilterHref({ job: null, tag: "tag_1" })).toBe("/photos?tag=tag_1");
  });

  it("escapes anything that would otherwise break the query string", () => {
    // Ids are cuids and contain nothing that needs escaping, so this is
    // about the function rather than about today's data: a filter value is
    // still a value going into a URL.
    expect(photosFilterHref({ tag: "a b&c=d" })).toBe("/photos?tag=a+b%26c%3Dd");
  });

  it("carries the client-visibility filter on its own, in both directions", () => {
    expect(photosFilterHref({ shared: "yes" })).toBe("/photos?shared=yes");
    // THE ONE THAT A BOOLEAN WOULD HAVE LOST. `false` is falsy, so the
    // idiom every other line here uses — `if (filter.x) params.set(…)` —
    // would drop it and hand back the unfiltered gallery. That failure has
    // no symptom: the page renders perfectly, showing every photo, to
    // somebody who asked which ones the client cannot see.
    expect(photosFilterHref({ shared: "no" })).toBe("/photos?shared=no");
    expect(photosFilterHref({ shared: null })).toBe("/photos");
  });

  it("carries all THREE, which is the requirement now", () => {
    // "What have we shown this GC of the west wall" is one question and it
    // needs all three chips at once. Any one of them silently dropped
    // answers a different question with total confidence.
    expect(photosFilterHref({ job: "job_1", tag: "tag_1", shared: "yes" })).toBe(
      "/photos?job=job_1&tag=tag_1&shared=yes",
    );
    expect(photosFilterHref({ job: "job_1", shared: "no" })).toBe("/photos?job=job_1&shared=no");
    expect(photosFilterHref({ tag: "tag_1", shared: "yes" })).toBe("/photos?tag=tag_1&shared=yes");
  });

  it("clearing any one of the three keeps the other two", () => {
    // Every chip on the page is one of these calls: the "All photos" chip
    // passes no `shared` and both of the others, and so on round.
    expect(photosFilterHref({ job: "job_1", tag: "tag_1" })).toBe("/photos?job=job_1&tag=tag_1");
    expect(photosFilterHref({ job: "job_1", tag: null, shared: "yes" })).toBe(
      "/photos?job=job_1&shared=yes",
    );
    expect(photosFilterHref({ job: null, tag: "tag_1", shared: "no" })).toBe(
      "/photos?tag=tag_1&shared=no",
    );
  });

  it("orders the parameters the same way however the filter object is built", () => {
    // So that two routes to the same view produce the same URL — a chip
    // clicked from a shared gallery and the same chip clicked from a tag
    // gallery must not look like two different pages to a browser's history
    // or to anyone reading a pasted link.
    const fromOneOrder = photosFilterHref({ shared: "yes", tag: "tag_1", job: "job_1" });
    const fromAnother = photosFilterHref({ job: "job_1", shared: "yes", tag: "tag_1" });
    expect(fromOneOrder).toBe(fromAnother);
    expect(fromOneOrder).toBe("/photos?job=job_1&tag=tag_1&shared=yes");
  });

  it("carries the location filter on its own, in both directions", () => {
    expect(photosFilterHref({ located: "yes" })).toBe("/photos?located=yes");
    // The same falsy-boolean trap as `shared` above. "No location" is a real
    // question — it is half the gallery — and a boolean `false` written the
    // idiomatic way here would be dropped, handing back every capture to
    // somebody who asked which ones have no position.
    expect(photosFilterHref({ located: "no" })).toBe("/photos?located=no");
    expect(photosFilterHref({ located: null })).toBe("/photos");
  });

  it("carries all FOUR, which is the requirement now", () => {
    // "Which of the west-wall photos on Riverside that we have shown Turner
    // do we know the position of" is one question and it needs four chips.
    // Any one of them silently dropped answers a different question with
    // total confidence.
    expect(
      photosFilterHref({ job: "job_1", tag: "tag_1", shared: "yes", located: "yes" }),
    ).toBe("/photos?job=job_1&tag=tag_1&shared=yes&located=yes");
    expect(photosFilterHref({ job: "job_1", located: "no" })).toBe("/photos?job=job_1&located=no");
    expect(photosFilterHref({ shared: "no", located: "yes" })).toBe(
      "/photos?shared=no&located=yes",
    );
  });

  it("clearing any one of the four keeps the other three", () => {
    // Every chip on the page is one of these calls: the "Anywhere" chip
    // passes no `located` and all three of the others, and so on round.
    expect(photosFilterHref({ job: "job_1", tag: "tag_1", shared: "yes" })).toBe(
      "/photos?job=job_1&tag=tag_1&shared=yes",
    );
    expect(photosFilterHref({ job: "job_1", tag: "tag_1", located: "no" })).toBe(
      "/photos?job=job_1&tag=tag_1&located=no",
    );
    expect(photosFilterHref({ tag: "tag_1", shared: "yes", located: "yes" })).toBe(
      "/photos?tag=tag_1&shared=yes&located=yes",
    );
  });

  it("round-trips through parseLocatedFilter, which is how the page reads it back", () => {
    for (const value of ["yes", "no"] as const) {
      const href = photosFilterHref({ located: value });
      const read = new URL(href, "https://example.test").searchParams.get("located");
      expect(parseLocatedFilter(read)).toBe(value);
    }
  });

  it("round-trips through parseSharedFilter, which is how the page reads it back", () => {
    // The two halves of one contract: this function writes the value into
    // the URL and `parseSharedFilter` reads it out on the next request. If
    // either side changed its spelling alone, the chip would render as
    // active and filter nothing — a page in a state it says it is not in.
    for (const shared of ["yes", "no"] as const) {
      const href = photosFilterHref({ shared });
      const value = new URL(href, "https://example.test").searchParams.get("shared");
      expect(parseSharedFilter(value)).toBe(shared);
    }
  });
});
