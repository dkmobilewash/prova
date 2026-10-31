import { describe, expect, it } from "vitest";
import {
  readTmTicketSnapshot,
  snapshotHours,
  tmTicketDraftDescription,
  tmTicketDraftTitle,
} from "./tm-ticket-change-order";

const snapshot = {
  labor: [
    { workerName: "Ana Ruiz", hours: "8", payType: "STRAIGHT", craftLabel: "Carpenter JM", lineItemDescription: "L3 corridor" },
    { workerName: "Luis Ortega", hours: "2.5", payType: "OVERTIME", craftLabel: null, lineItemDescription: null },
  ],
  materials: [{ description: "40 sheets 5/8 type X", vendorName: "Foundation", orderedOn: "2026-09-10" }],
};

const input = {
  day: "2026-09-10",
  workDescription: "Reframed the L3 corridor soffit after the duct moved",
  snapshot,
  signerName: "Sam Patel (GC super)",
  signedAtText: "Sep 10, 2026, 4:12 PM MDT",
  hasDrawnSignature: true,
  photoCount: 3,
};

describe("the draft's words", () => {
  it("carries the frozen snapshot: every worker, their hours and pay type, every material, and the total", () => {
    const text = tmTicketDraftDescription(input);
    expect(text).toContain("Labor as signed for — 10.5 hours:");
    expect(text).toContain("Ana Ruiz — 8 h, straight time, Carpenter JM — on L3 corridor");
    expect(text).toContain("Luis Ortega — 2.5 h, overtime");
    expect(text).toContain("40 sheets 5/8 type X — Foundation (ordered 2026-09-10)");
  });

  it("names the signer, when, and whether a drawn signature is on file", () => {
    expect(tmTicketDraftDescription(input)).toContain(
      "signed on site by Sam Patel (GC super), Sep 10, 2026, 4:12 PM MDT (drawn signature on file).",
    );
    expect(tmTicketDraftDescription({ ...input, hasDrawnSignature: false })).toContain("typed name");
  });

  it("points at the day's photos without claiming the ticket holds any", () => {
    expect(tmTicketDraftDescription(input)).toContain("Photos: 3 job photos captured on 2026-09-10");
    expect(tmTicketDraftDescription({ ...input, photoCount: 1 })).toContain("1 job photo captured");
    expect(tmTicketDraftDescription({ ...input, photoCount: 0 })).toContain("Photos: none captured on this job on 2026-09-10.");
  });

  it("says in words how the lines below were priced and what still needs a figure", () => {
    const text = tmTicketDraftDescription(input);
    expect(text).toContain("a line marked UNPRICED needs its rate entered, and every material needs its cost");
    expect(text).not.toMatch(/\$\d/);
  });

  it("drafts from a ticket with nothing on it rather than throwing, and from a malformed snapshot", () => {
    const empty = tmTicketDraftDescription({ ...input, snapshot: { labor: [], materials: [] } });
    expect(empty).toContain("(no time entries were on the ticket)");
    expect(empty).toContain("(no material orders were on the ticket)");
    expect(empty).toContain("— 0 hours:");
    for (const bad of [null, "text", 42, { labor: "nope" }, { materials: [{}] }]) {
      expect(() => tmTicketDraftDescription({ ...input, snapshot: bad })).not.toThrow();
    }
    expect(readTmTicketSnapshot({ materials: [{}] }).materials[0].description).toBe("(no description)");
  });

  it("sums hours without float dust and ignores an unreadable figure", () => {
    expect(snapshotHours(readTmTicketSnapshot({ labor: [{ hours: "0.1" }, { hours: "0.2" }, { hours: "x" }] }))).toBe(0.3);
  });

  it("keeps the title under 80 characters and starts it with the day", () => {
    expect(tmTicketDraftTitle(input)).toBe("T&M 2026-09-10: Reframed the L3 corridor soffit after the duct moved");
    const long = tmTicketDraftTitle({ day: "2026-09-10", workDescription: "x".repeat(200) });
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
