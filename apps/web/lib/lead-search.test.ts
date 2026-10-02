import { describe as group, expect, it } from "vitest";
import { LEAD_FIELDS, type FoundLead } from "@prova/integrations";
import { LEAD_NOTE_LABELS, NOTE_MAX_CHARS, leadPrefillFrom } from "./lead-search";

/**
 * The lead-to-pursuit mapping, checked where it is testable.
 *
 * The case that earns its keep is the one asserting a lead's bid date does NOT
 * reach `expectedBidDate`. A lead's whole appeal is its bid date, the column
 * exists, and the value looks like a date — so that refusal is the single most
 * likely thing for somebody to "fix" without reading why, and a test is the only
 * thing that argues back.
 */

function lead(fields: Partial<FoundLead["fields"]> & { projectName: string }, url = "https://bids.example.gov/p/1"): FoundLead {
  return { source: { title: "Bid board", url }, fields };
}

group("a found lead to the pursuit form", () => {
  it("fills the one column a lead has, and the name", () => {
    const prefill = leadPrefillFrom(lead({ projectName: "Mercy Clinic Expansion", owner: "Renown Health" }));
    expect(prefill.projectName).toBe("Mercy Clinic Expansion");
    expect(prefill.owner).toBe("Renown Health");
  });

  it("NEVER fills the bid date field, and keeps the date as text with its source", () => {
    const prefill = leadPrefillFrom(lead({ projectName: "P", bidDate: "November 14, 2026 at 2:00 PM" }));
    // Enforced by the type too — `LeadPrefill` has no `expectedBidDate` key —
    // but a type is one edit from being widened, and this says why it must not
    // be: a date a bid board printed is not the user's assertion about when
    // their bid is due, and a wrong one is how a bid is rejected unread.
    expect(prefill).not.toHaveProperty("expectedBidDate");
    expect(prefill.note).toContain("November 14, 2026 at 2:00 PM");
  });

  it("never fills architect, which a lead does not have", () => {
    // `LEAD_FIELDS` has no architect. If one is ever added, this test is where
    // somebody decides whether it maps to the column rather than discovering
    // later that it silently went to the note.
    expect([...LEAD_FIELDS]).not.toContain("architect");
    expect(leadPrefillFrom(lead({ projectName: "P" }))).not.toHaveProperty("architect");
  });

  it("labels every column-less field, so nothing lands in the note unnamed", () => {
    // Derived against LEAD_FIELDS rather than listed: a new field added to the
    // integration would otherwise appear in a note as its raw key.
    const columnless = LEAD_FIELDS.filter((field) => field !== "projectName" && field !== "owner");
    for (const field of columnless) {
      expect(LEAD_NOTE_LABELS[field], `${field} has no note label`).toBeTruthy();
    }
  });

  it("puts every field it was given into the note, in the declared order", () => {
    const prefill = leadPrefillFrom(
      lead({
        projectName: "P",
        location: "Reno, NV",
        bidDate: "Nov 14",
        scopeSummary: "New clinic shell",
        sizeText: "48,000 sq ft",
        deliveryMethod: "CM at risk",
      }),
    );
    // DERIVED FROM `LEAD_FIELDS`, not from a hand-written order. The first
    // version of this test hardcoded my own guess at the sequence, asserted
    // Size before Scope, and failed — the declaration has it the other way
    // round. A test that restates the thing under test from memory is a test
    // that can disagree with it, which is the whole point of deriving.
    const expected = LEAD_FIELDS.filter((field) => field !== "projectName" && field !== "owner")
      .map((field) => LEAD_NOTE_LABELS[field]!)
      .filter((label) => prefill.note!.includes(label));
    const positions = expected.map((label) => prefill.note!.indexOf(label));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // And all five really are present, so the ordering check is not vacuous
    // over an empty list.
    expect(expected.length).toBe(5);
  });

  it("always keeps the source link, even when facts have to be dropped", () => {
    const url = "https://bids.example.gov/very/long/path/to/the/solicitation/page";
    const prefill = leadPrefillFrom(
      lead(
        {
          projectName: "P",
          location: "x".repeat(200),
          scopeSummary: "y".repeat(200),
          sizeText: "z".repeat(200),
          deliveryMethod: "w".repeat(200),
        },
        url,
      ),
    );
    expect(prefill.note!.length).toBeLessThanOrEqual(NOTE_MAX_CHARS);
    // The link is what makes every fact above it checkable, so it survives a
    // clip that the facts do not.
    expect(prefill.note).toContain(url);
  });

  it("writes a note even for a lead with nothing but a name", () => {
    const prefill = leadPrefillFrom(lead({ projectName: "P" }));
    // Still carries where it came from — a pursuit with no provenance is one
    // nobody can check later.
    expect(prefill.note).toContain("https://bids.example.gov/p/1");
  });
});
