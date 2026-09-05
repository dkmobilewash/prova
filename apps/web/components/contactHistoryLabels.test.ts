import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contactDeleteRefusal,
  contactHistoryHeld,
  joinHeld,
  type ContactHistoryCounts,
} from "./contactHistoryLabels";

const none: ContactHistoryCounts = { jobs: 0, bidInvitations: 0, interactions: 0, people: 0 };

describe("contactDeleteRefusal", () => {
  it("returns null when there is no history, which is the only case that may be deleted", () => {
    expect(contactDeleteRefusal("Acme GC", none)).toBeNull();
  });

  // Issue #76, stated exactly as it was reported: a contact with no jobs and
  // three bid invitations was told "Acme GC has 0 job(s) and 3 bid
  // invitation(s) on file". Zero of something is not a reason for anything.
  it("never names a zero count as part of the reason", () => {
    const message = contactDeleteRefusal("Acme GC", { ...none, bidInvitations: 3 });
    expect(message).not.toBeNull();
    expect(message).toBe(
      "Acme GC has 3 bid invitations on file, so its record stays. Only a contact with no history can be deleted.",
    );
    expect(message).not.toContain("0 job");
    expect(message).not.toContain("0 logged interaction");
    expect(message).not.toContain("0 people");
    expect(message).not.toMatch(/\b0\b/);
  });

  it("names every non-zero count and nothing else", () => {
    expect(contactDeleteRefusal("Northline Builders", { jobs: 3, bidInvitations: 2, interactions: 1, people: 4 })).toBe(
      "Northline Builders has 3 jobs, 2 bid invitations, 1 logged interaction and 4 people on file, so its record stays. Only a contact with no history can be deleted.",
    );
  });

  it("pluralises by the count rather than with a parenthesised (s)", () => {
    expect(contactDeleteRefusal("Solo GC", { ...none, jobs: 1 })).toContain("has 1 job on file");
    expect(contactDeleteRefusal("Solo GC", { ...none, jobs: 2 })).toContain("has 2 jobs on file");
    expect(contactDeleteRefusal("Solo GC", { ...none, people: 1 })).toContain("has 1 person on file");
    expect(contactDeleteRefusal("Solo GC", { ...none, people: 2 })).toContain("has 2 people on file");
    expect(contactDeleteRefusal("Solo GC", { ...none, interactions: 1 })).toContain("has 1 logged interaction on file");
    expect(contactDeleteRefusal("Solo GC", { ...none, bidInvitations: 1 })).toContain("has 1 bid invitation on file");
    expect(contactDeleteRefusal("Solo GC", { jobs: 1, bidInvitations: 1, interactions: 1, people: 1 })).not.toContain(
      "(s)",
    );
  });
});

describe("contactHistoryHeld", () => {
  it("is empty only when every count is zero", () => {
    expect(contactHistoryHeld(none)).toEqual([]);
    expect(contactHistoryHeld({ ...none, people: 1 })).toEqual(["1 person"]);
  });

  it("drops the zero parts and keeps the order stable", () => {
    expect(contactHistoryHeld({ jobs: 0, bidInvitations: 2, interactions: 0, people: 5 })).toEqual([
      "2 bid invitations",
      "5 people",
    ]);
  });
});

/**
 * The other half of the fix, and the half that has silently failed in this
 * repo before: CLAUDE.md records three helpers that were "written,
 * documented, and never called", each of which typechecked and tested
 * green the whole time because nothing referenced them.
 *
 * A message helper nothing calls fixes no message. So this reads the
 * action's own source and requires the wiring, rather than trusting that
 * the diff looked complete. Source-reading in a test follows
 * lib/action-capability-guards.test.ts, which does the same for the same
 * reason.
 */
describe("deleteContact actually uses it", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../lib/actions/company.ts", import.meta.url)),
    "utf8",
  );
  const deleteContactBody = source.slice(
    source.indexOf("export async function deleteContact"),
    source.indexOf("export async function updateContact"),
  );

  it("finds deleteContact where this test expects it", () => {
    // Guards the two indexOf calls above: if either function is renamed or
    // moved, the slice silently becomes empty and every assertion below
    // would pass on nothing.
    expect(source).toContain("export async function deleteContact");
    expect(source).toContain("export async function updateContact");
    expect(deleteContactBody.length).toBeGreaterThan(100);
  });

  it("calls contactDeleteRefusal rather than composing its own sentence", () => {
    expect(deleteContactBody).toContain("contactDeleteRefusal(");
    expect(source).toContain('from "@/components/contactHistoryLabels"');
  });

  it("no longer interpolates a raw count with a parenthesised (s)", () => {
    expect(deleteContactBody).not.toContain("job(s)");
    expect(deleteContactBody).not.toContain("bid invitation(s)");
    expect(deleteContactBody).not.toContain("logged interaction(s)");
  });
});

describe("joinHeld", () => {
  it("reads as a sentence at one, two and three parts", () => {
    expect(joinHeld([])).toBe("");
    expect(joinHeld(["1 job"])).toBe("1 job");
    expect(joinHeld(["1 job", "2 people"])).toBe("1 job and 2 people");
    expect(joinHeld(["1 job", "2 people", "3 bid invitations"])).toBe("1 job, 2 people and 3 bid invitations");
  });
});
