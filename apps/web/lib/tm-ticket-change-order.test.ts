import { describe, expect, it } from "vitest";
import {
  parseTicketExtras,
  readTmTicketSnapshot,
  ticketAllowances,
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

  it("says how many photos were on the ticket, and nothing when there were none", () => {
    expect(tmTicketDraftDescription({ ...input, ticketPhotoCount: 2 })).toContain("2 photos were attached to this ticket when this was drafted.");
    expect(tmTicketDraftDescription({ ...input, ticketPhotoCount: 1 })).toContain("1 photo was attached");
    expect(tmTicketDraftDescription(input)).not.toContain("attached to this ticket");
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

describe("per diem, travel and mileage on a ticket", () => {
  const snap = (raw: Record<string, unknown>) => readTmTicketSnapshot({ labor: [], materials: [], ...raw });
  const worked = (perDiemAmount: string | null, travelPayAmount: string | null) => ({ hours: "8", perDiemAmount, travelPayAmount });

  it("reads what the phone sent, dropping blanks and zeros", () => {
    expect(parseTicketExtras({ perDiem: "75", travel: "", miles: "40", mileRate: "0.725" })).toEqual({
      ok: true,
      extras: [{ kind: "PER_DIEM", amount: "75.00" }, { kind: "MILEAGE", miles: "40", rate: "0.725" }],
    });
    expect(parseTicketExtras({ perDiem: "0", travel: " " })).toEqual({ ok: true, extras: [] });
    expect(parseTicketExtras(undefined)).toEqual({ ok: true, extras: [] });
    expect(parseTicketExtras({ perDiem: "75,50" })).toEqual({ ok: true, extras: [{ kind: "PER_DIEM", amount: "75.50" }] });
  });

  it("refuses a figure that is not one, or a rate with no miles, in words", () => {
    expect(parseTicketExtras({ perDiem: "-5" })).toMatchObject({ ok: false });
    expect(parseTicketExtras({ miles: "lots" })).toMatchObject({ ok: false });
    expect(parseTicketExtras({ mileRate: "0.7" })).toEqual({ ok: false, error: "Enter the miles for that mileage rate." });
  });

  it("totals the day's time entries, without float dust", () => {
    expect(ticketAllowances(snap({ labor: [worked("0.10", null), worked("0.20", "45")] }))).toEqual([
      { text: "Per diem — $0.30 from the day's time entries", costCategory: "OTHER", cost: 0.3 },
      { text: "Travel — $45.00 from the day's time entries", costCategory: "OTHER", cost: 45 },
    ]);
  });

  it("never prices the same per diem twice, and says what it left out", () => {
    const rows = ticketAllowances(snap({ labor: [worked("50", null)], extras: [{ kind: "PER_DIEM", amount: "75.00" }] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(75);
    expect(rows[0].text).toContain("the time entries show $50.00, not added");
  });

  it("keeps a mile rate finer than a cent as signed, and costs it to the cent", () => {
    expect(ticketAllowances(snap({ extras: [{ kind: "MILEAGE", miles: "37", rate: "0.725" }] }))).toEqual([
      { text: "Mileage — 37 mi @ $0.725", costCategory: "EQUIPMENT", cost: 26.83 },
    ]);
  });

  it("invents no mile rate", () => {
    const [row] = ticketAllowances(snap({ extras: [{ kind: "MILEAGE", miles: "37", rate: null }] }));
    expect(row.cost).toBeNull();
    expect(row.text).toContain("UNPRICED");
  });

  it("leaves an older ticket's words alone", () => {
    const older = tmTicketDraftDescription({ ...input, snapshot: { labor: [{ workerName: "A", hours: "1" }], materials: [] } });
    expect(older).not.toContain("Per diem");
    const newer = tmTicketDraftDescription({ ...input, snapshot: { labor: [], materials: [], extras: [{ kind: "TRAVEL", amount: "45.00" }] } });
    expect(newer).toContain("Per diem, travel and mileage:\n  Travel — $45.00 entered on the ticket");
  });
});
