import { describe as group, expect, it } from "vitest";
import { NOTE_MAX_CHARS, NOTE_ONLY_FIELDS, pursuitPrefillFrom } from "./project-lookup";
import type { WebSuggestion } from "@/lib/ask/webSuggestions";

/**
 * The mapping from web-found facts to the pursuit form, checked where it is
 * testable. The component that renders it is not — `sheetIndex.ts` says why, and
 * the unit suite runs in `environment: "node"`.
 *
 * The case that matters most is the one asserting a found bid date does NOT
 * reach `expectedBidDate`. That is a deliberate refusal to do something the
 * schema would allow, so without a test it is one helpful edit away from being
 * undone by somebody who reads the gap as an oversight.
 */

function found(key: string, value: string, url = "https://example.com/a"): WebSuggestion {
  return { key, label: key, value, sources: [{ title: key, url }] };
}

group("web-found facts to the pursuit form", () => {
  it("puts the three fields that have columns into those columns", () => {
    const prefill = pursuitPrefillFrom("Mercy Clinic", [
      found("owner", "Renown Health"),
      found("architect", "HGA"),
      found("generalContractors", "Clark, Q&D"),
    ]);
    expect(prefill.projectName).toBe("Mercy Clinic");
    expect(prefill.owner).toBe("Renown Health");
    expect(prefill.architect).toBe("HGA");
    // Renamed on the way: `generalContractors` is what research calls it,
    // `expectedGcs` is what the column is called.
    expect(prefill.expectedGcs).toBe("Clark, Q&D");
    expect(prefill.note).toBeUndefined();
  });

  it("NEVER fills the bid date field from a web page, and keeps it as text instead", () => {
    const prefill = pursuitPrefillFrom("Mercy Clinic", [found("bidDate", "Nov 14 at 2pm")]);
    // The whole point. `BidPursuitPrefill` has no `expectedBidDate` key, so this
    // is enforced by the type as well — but a type can be widened by one edit,
    // and this says why it must not be: a date read off a plan-room page is not
    // the user's assertion about when their bid is due, and a wrong bid date is
    // how a bid is rejected unread.
    expect(prefill).not.toHaveProperty("expectedBidDate");
    expect(prefill.note).toContain("Nov 14 at 2pm");
  });

  it("carries a fact with no column into the note, with its source kept", () => {
    const prefill = pursuitPrefillFrom("Mercy Clinic", [
      found("planRoom", "Bid docs here", "https://planroom.example.com/mercy"),
    ]);
    expect(prefill.note).toContain("Bid docs here");
    // The link survives the save, or the source was lost at the only moment it
    // mattered — this feature promises never to show a fact without one.
    expect(prefill.note).toContain("https://planroom.example.com/mercy");
  });

  it("names every column-less field in NOTE_ONLY_FIELDS, so the UI can say so", () => {
    // The component prints "goes in the note" from this list. A field missing
    // from it would silently land in the note with nothing telling the person.
    for (const key of NOTE_ONLY_FIELDS) {
      const prefill = pursuitPrefillFrom("P", [found(key, `value of ${key}`)]);
      expect(prefill.note, `${key} should land in the note`).toContain(`value of ${key}`);
      expect(prefill, `${key} must not invent a column`).not.toHaveProperty(key);
    }
  });

  it("sends an unknown field to the note rather than dropping it", () => {
    // A research field added later, before anybody teaches this file about it.
    // The note is the safe direction: visible to the person, writes no column.
    const prefill = pursuitPrefillFrom("P", [found("unionAgreement", "IUPAT DC 15")]);
    expect(prefill.note).toContain("IUPAT DC 15");
  });

  it("keeps the note inside the column's limit and never cuts a URL in half", () => {
    const long = Array.from({ length: 12 }, (_, index) =>
      found(`field${index}`, `a fairly wordy finding number ${index} about the project`, `https://example.com/source-${index}`),
    );
    const prefill = pursuitPrefillFrom("P", long);
    expect(prefill.note!.length).toBeLessThanOrEqual(NOTE_MAX_CHARS);
    // Cut at a line boundary, so what survives is whole facts with whole links.
    // Half a URL is worse than no URL: it looks like a link and is not.
    const urls = prefill.note!.match(/https:\/\/example\.com\/source-\d+/g) ?? [];
    for (const url of urls) {
      expect(prefill.note).toContain(url);
    }
    expect(prefill.note!.endsWith("·")).toBe(false);
  });

  it("still returns a readable note when one single fact is longer than the limit", () => {
    const prefill = pursuitPrefillFrom("P", [found("projectScope", "x".repeat(NOTE_MAX_CHARS + 200))]);
    // Clipped rather than dropped — a fact the person can read beats an empty
    // note, which would look like nothing was found.
    expect(prefill.note).toBeDefined();
    expect(prefill.note!.length).toBe(NOTE_MAX_CHARS);
  });

  it("omits the project name when nothing was typed, rather than writing a blank", () => {
    const prefill = pursuitPrefillFrom("   ", [found("owner", "Renown Health")]);
    expect(prefill.projectName).toBeUndefined();
    // `createBidPursuit` refuses a nameless pursuit with its own sentence, which
    // is the right place for that refusal to come from.
    expect(prefill.owner).toBe("Renown Health");
  });

  it("writes nothing at all from an empty set of kept facts", () => {
    expect(pursuitPrefillFrom("Mercy Clinic", [])).toEqual({ projectName: "Mercy Clinic" });
  });
});
