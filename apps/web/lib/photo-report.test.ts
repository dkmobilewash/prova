import { describe, expect, it } from "vitest";
import {
  PHOTO_REPORT_DEFAULT_SELECTION,
  PHOTO_REPORT_LIMIT,
  PHOTO_REPORT_SELECTIONS,
  type PhotoReportSelection,
  groupByDay,
  oldestFirst,
  parsePhotoReportSelection,
  partitionPrintable,
  photoReportCapNote,
  photoReportHref,
  photoReportIsInternal,
  photoReportSelectionLabel,
  photoReportSharedFlag,
  selectionFromSharedFilter,
} from "./photo-report";

/**
 * The rules behind a printed site photo report.
 *
 * Every one of these decides what appears on a piece of paper somebody may
 * hand to a general contractor, which is why the interesting cases here are
 * all about the SAFE direction rather than the correct one: an unrecognised
 * parameter, a falsy filter value, a link that drops the other filter. Each
 * of those failures produces a document that looks completely fine and
 * contains more than the person meant to disclose.
 */

const capture = (kind: "photo" | "video" | "audio", dayLabel: string, id: string = kind) => ({
  id,
  kind,
  dayLabel,
});

describe("parsePhotoReportSelection", () => {
  it("accepts each of the three real selections", () => {
    for (const value of PHOTO_REPORT_SELECTIONS) {
      expect(parsePhotoReportSelection(value)).toBe(value);
    }
  });

  it("falls back to the SHARED set, never to everything", () => {
    // The whole safety posture of the document in one assertion. A stale
    // link, a typo, a hand-edited URL and a missing parameter all have to
    // land on the captures the client has already been shown — falling back
    // to "everything" would publish the backcharge evidence to whoever
    // pressed print, with nothing on the page saying anything was widened.
    for (const raw of [undefined, null, "", "yes", "all", "EVERYTHING", "shared "]) {
      expect(parsePhotoReportSelection(raw)).toBe("shared");
    }
    expect(PHOTO_REPORT_DEFAULT_SELECTION).toBe("shared");
  });
});

describe("photoReportSharedFlag", () => {
  it("maps the two narrowing selections to true and false", () => {
    expect(photoReportSharedFlag("shared")).toBe(true);
    expect(photoReportSharedFlag("not-shared")).toBe(false);
  });

  it("gives undefined — not false — for everything", () => {
    // THE FALSY-BOOLEAN TRAP, from the other end. `false` here means "only
    // the ones the client cannot see" and `undefined` means "do not filter
    // at all"; a function that returned `false` for "everything" would
    // print the internal-only report under the everything heading, and a
    // caller that spread this with `...(flag ? {shared: flag} : {})` would
    // drop the "not shared" filter and print the lot. Both are checked
    // explicitly rather than by truthiness.
    expect(photoReportSharedFlag("everything")).toBeUndefined();
    expect(photoReportSharedFlag("not-shared")).not.toBeUndefined();
  });

  it("answers for every selection there is", () => {
    // A census rather than three literals: adding a fourth member to the
    // union and forgetting it here would return undefined, which is the
    // widest possible filter, silently.
    for (const value of PHOTO_REPORT_SELECTIONS) {
      const flag = photoReportSharedFlag(value);
      expect(value === "everything" ? flag === undefined : typeof flag === "boolean").toBe(true);
    }
  });
});

describe("photoReportSelectionLabel", () => {
  it("gives every selection its own printable sentence", () => {
    const labels = PHOTO_REPORT_SELECTIONS.map(photoReportSelectionLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(10);
    // Distinct, because this sentence is the only thing on the paper that
    // says what the document contains. Two selections sharing a label would
    // make an internal report indistinguishable from a client-safe one once
    // it is printed.
    expect(new Set(labels).size).toBe(PHOTO_REPORT_SELECTIONS.length);
  });

  it("says out loud when the client has NOT seen the contents", () => {
    expect(photoReportSelectionLabel("not-shared")).toMatch(/NOT shared/);
    expect(photoReportSelectionLabel("shared")).toMatch(/already shared/);
  });
});

describe("photoReportIsInternal", () => {
  it("is false only for the already-disclosed selection", () => {
    expect(photoReportIsInternal("shared")).toBe(false);
    expect(photoReportIsInternal("not-shared")).toBe(true);
    expect(photoReportIsInternal("everything")).toBe(true);
  });

  it("treats any selection it does not recognise as internal", () => {
    // Conservative by construction: the test is `!== "shared"`, so a
    // selection added later is internal until somebody decides otherwise.
    // The opposite default would ship a new selection with no banner.
    expect(photoReportIsInternal("something-new" as PhotoReportSelection)).toBe(true);
  });
});

describe("selectionFromSharedFilter", () => {
  it("carries the gallery's two real filter values across", () => {
    expect(selectionFromSharedFilter("yes")).toBe("shared");
    expect(selectionFromSharedFilter("no")).toBe("not-shared");
  });

  it("narrows an UNFILTERED gallery to the safe selection", () => {
    // "All photos" on `/photos` means everything; the naive translation is
    // an everything REPORT, produced by somebody who clicked a link rather
    // than chose a disclosure. Narrowing is the right direction to be wrong
    // in — the report's own chips widen it in one click and say so.
    expect(selectionFromSharedFilter(null)).toBe("shared");
    expect(selectionFromSharedFilter(undefined)).toBe("shared");
    expect(selectionFromSharedFilter(null)).not.toBe("everything");
  });
});

describe("photoReportHref", () => {
  it("leaves the safe default out of the URL entirely", () => {
    // So the bare link and the explicitly-safe link are the same document
    // and neither can drift from the other.
    expect(photoReportHref("job1")).toBe("/jobs/job1/photo-report");
    expect(photoReportHref("job1", { selection: "shared" })).toBe("/jobs/job1/photo-report");
  });

  it("writes a widened selection down", () => {
    expect(photoReportHref("job1", { selection: "everything" })).toBe(
      "/jobs/job1/photo-report?include=everything",
    );
    expect(photoReportHref("job1", { selection: "not-shared" })).toBe(
      "/jobs/job1/photo-report?include=not-shared",
    );
  });

  it("keeps the other filter when either one changes", () => {
    // The failure this function exists to prevent: a chip that quietly
    // drops the other filter produces a document with MORE on it than was
    // asked for, which looks exactly like a working page. On this surface
    // that publishes photographs.
    expect(photoReportHref("job1", { selection: "everything", tag: "tag9" })).toBe(
      "/jobs/job1/photo-report?include=everything&tag=tag9",
    );
    expect(photoReportHref("job1", { selection: "shared", tag: "tag9" })).toBe(
      "/jobs/job1/photo-report?tag=tag9",
    );
  });

  it("treats null and undefined as not-filtered rather than as values", () => {
    expect(photoReportHref("job1", { selection: null, tag: null })).toBe(
      "/jobs/job1/photo-report",
    );
  });
});

describe("photoReportCapNote", () => {
  it("says nothing when the document holds everything it matched", () => {
    expect(photoReportCapNote(12, 12)).toBeNull();
    expect(photoReportCapNote(PHOTO_REPORT_LIMIT, 4)).toBeNull();
  });

  it("names BOTH numbers when it is withholding some", () => {
    // A capped document that says nothing is one whose reader believes they
    // hold the whole record — and this one may be read months later by
    // somebody who was not there when it was printed.
    const note = photoReportCapNote(100, 143);
    expect(note).toContain("100");
    expect(note).toContain("143");
  });

  it("caps at a number a browser can actually print", () => {
    expect(PHOTO_REPORT_LIMIT).toBe(100);
  });
});

describe("partitionPrintable", () => {
  it("puts photographs on one side and recordings on the other", () => {
    const items = [
      capture("photo", "Monday", "p1"),
      capture("video", "Monday", "v1"),
      capture("audio", "Monday", "a1"),
      capture("photo", "Tuesday", "p2"),
    ];
    const { printable, notPrintable } = partitionPrintable(items);
    expect(printable.map((i) => i.id)).toEqual(["p1", "p2"]);
    expect(notPrintable.map((i) => i.id)).toEqual(["v1", "a1"]);
  });

  it("never drops a capture on the floor", () => {
    // The decision this function encodes: a video is LISTED, not omitted.
    // A document that silently loses a walk-through tells its reader the
    // job's record is these photographs.
    const items = [capture("video", "Mon", "v"), capture("audio", "Mon", "a")];
    const { printable, notPrintable } = partitionPrintable(items);
    expect(printable).toEqual([]);
    expect(printable.length + notPrintable.length).toBe(items.length);
  });

  it("keeps the order it was given within each side", () => {
    const items = [
      capture("photo", "Mon", "first"),
      capture("photo", "Mon", "second"),
      capture("photo", "Mon", "third"),
    ];
    expect(partitionPrintable(items).printable.map((i) => i.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });
});

describe("oldestFirst", () => {
  it("turns the query's newest-first into the document's front-to-back", () => {
    expect(oldestFirst([3, 2, 1])).toEqual([1, 2, 3]);
  });

  it("does not mutate what it was handed", () => {
    // The caller's array is a query result other code on the page also
    // reads; reversing in place would reorder a gallery somewhere else.
    const rows = [3, 2, 1];
    oldestFirst(rows);
    expect(rows).toEqual([3, 2, 1]);
  });

  it("survives an empty document", () => {
    expect(oldestFirst([])).toEqual([]);
  });
});

describe("groupByDay", () => {
  it("gathers a run of captures under one heading", () => {
    const groups = groupByDay([
      capture("photo", "Friday, September 4, 2026", "a"),
      capture("photo", "Friday, September 4, 2026", "b"),
      capture("photo", "Saturday, September 5, 2026", "c"),
    ]);
    expect(groups.map((g) => g.day)).toEqual([
      "Friday, September 4, 2026",
      "Saturday, September 5, 2026",
    ]);
    expect(groups[0].captures.map((c) => c.id)).toEqual(["a", "b"]);
    expect(groups[1].captures.map((c) => c.id)).toEqual(["c"]);
  });

  it("groups CONSECUTIVE runs only, never by lookup", () => {
    // Gathering non-adjacent captures under one heading would silently
    // reorder the document. Two runs sharing a label is the honest
    // rendering of an input that was not ordered the way this function was
    // promised — and a reader can see it, which a silent reorder is not.
    const groups = groupByDay([
      capture("photo", "Mon", "a"),
      capture("photo", "Tue", "b"),
      capture("photo", "Mon", "c"),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["Mon", "Tue", "Mon"]);
    expect(groups).toHaveLength(3);
  });

  it("loses nothing", () => {
    const items = ["Mon", "Mon", "Tue", "Wed", "Wed", "Wed"].map((d, i) =>
      capture("photo", d, `c${i}`),
    );
    const groups = groupByDay(items);
    expect(groups.flatMap((g) => g.captures).map((c) => c.id)).toEqual(items.map((c) => c.id));
  });

  it("returns nothing for nothing, rather than an empty heading", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
