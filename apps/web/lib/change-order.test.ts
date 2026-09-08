import { describe, expect, it } from "vitest";
import { Prisma } from "@prova/db";
import {
  changeOrderValueDelta,
  countUnbookable,
  laterApprovedConflict,
  pendingChangeOrderExposure,
  pendingChangeOrderUnbookable,
  proposalIsBookable,
  proposalValueDelta,
  type LineItemForChangeOrder,
  type ProposalForCalc,
} from "./change-order";

/**
 * The arithmetic behind "how much are we asking the GC for", and the guard
 * on unwinding an approved change order.
 *
 * Both are money the contract value depends on, and neither had a test —
 * this file was the only calculation module in lib/ without one, which is
 * exactly how a declared-and-never-read `isDeleted` field (#105 finding 5)
 * and a missing later-change-order check (#105 finding 1) both survived.
 */

const d = (value: string | number) => new Prisma.Decimal(value);

function line(overrides: Partial<LineItemForChangeOrder> = {}): LineItemForChangeOrder {
  return {
    id: "line-1",
    quantity: d(100),
    unitPrice: d(50),
    isDeleted: false,
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalForCalc> = {}): ProposalForCalc {
  return {
    changeType: "EDIT",
    lineItemId: "line-1",
    quantity: null,
    unitPrice: null,
    ...overrides,
  };
}

describe("proposalValueDelta", () => {
  it("prices added scope at quantity times unit price", () => {
    expect(
      proposalValueDelta(
        proposal({ changeType: "ADD", lineItemId: null, quantity: d(10), unitPrice: d(25) }),
        null,
      ).toString(),
    ).toBe("250");
  });

  it("subtracts what a removed line is worth right now", () => {
    // 100 @ $50 = $5,000 of scope going away.
    expect(proposalValueDelta(proposal({ changeType: "REMOVE" }), line()).toString()).toBe("-5000");
  });

  it("prices an edit as the difference, not the new value", () => {
    // 100 @ $50 becoming 120 @ $50 is +$1,000, not +$6,000.
    expect(proposalValueDelta(proposal({ quantity: d(120) }), line()).toString()).toBe("1000");
  });
});

describe("scope another change order already removed (#105 finding 5)", () => {
  // The defect: LineItemForChangeOrder declared isDeleted and nothing ever
  // read it. A pending REMOVE of a line an earlier approved change order had
  // already soft-deleted reported −$5,000 of exposure — money the headline
  // asked the GC for that could never be booked, because approveChangeOrder
  // refuses that exact proposal.

  const removedLine = line({ isDeleted: true });

  it("is worth nothing to remove scope that has already gone", () => {
    expect(proposalIsBookable(proposal({ changeType: "REMOVE" }), removedLine)).toBe(false);
    expect(proposalValueDelta(proposal({ changeType: "REMOVE" }), removedLine).toString()).toBe("0");
  });

  it("is worth nothing to edit scope that has already gone", () => {
    expect(proposalValueDelta(proposal({ quantity: d(500) }), removedLine).toString()).toBe("0");
  });

  it("still counts an APPLIED removal, which is the whole point of the snapshot", () => {
    // After approval the line IS deleted — that is what approval did. The
    // snapshot is the record of what it was worth when it went, and zeroing
    // this one would erase an approved change order's own recorded effect.
    const applied = proposal({
      changeType: "REMOVE",
      previousQuantity: d(100),
      previousUnitPrice: d(50),
      previousIsDeleted: false,
    });
    expect(proposalIsBookable(applied, removedLine)).toBe(true);
    expect(proposalValueDelta(applied, removedLine).toString()).toBe("-5000");
  });

  it("an ADD proposal is always bookable, regardless of any target", () => {
    expect(proposalIsBookable(proposal({ changeType: "ADD", lineItemId: null }), null)).toBe(true);
  });

  it("counts what a total dropped rather than shrinking silently", () => {
    const targets = new Map([["line-1", removedLine]]);
    const proposals = [proposal({ changeType: "REMOVE" }), proposal({ quantity: d(120) })];

    expect(changeOrderValueDelta(proposals, targets).toString()).toBe("0");
    expect(countUnbookable(proposals, targets)).toBe(2);
  });

  it("keeps the pending exposure to money that can actually be booked", () => {
    // Hand-worked: one pending change order adds 10 @ $300 = +$3,000 and
    // removes a line that is already gone. The honest exposure is $3,000
    // with one proposal flagged as unbookable — not −$2,000.
    const targets = new Map([["line-1", removedLine]]);
    const changeOrders = [
      {
        status: "SUBMITTED",
        proposals: [
          proposal({ changeType: "ADD", lineItemId: null, quantity: d(10), unitPrice: d(300) }),
          proposal({ changeType: "REMOVE" }),
        ],
      },
    ];

    expect(pendingChangeOrderExposure(changeOrders, targets).toString()).toBe("3000");
    expect(pendingChangeOrderUnbookable(changeOrders, targets)).toBe(1);
  });

  it("leaves a live line alone", () => {
    const targets = new Map([["line-1", line()]]);
    const proposals = [proposal({ changeType: "REMOVE" })];
    expect(changeOrderValueDelta(proposals, targets).toString()).toBe("-5000");
    expect(countUnbookable(proposals, targets)).toBe(0);
  });

  it("a proposal targeting a line missing from the map entirely is also unbookable", () => {
    // No approved-elsewhere snapshot and no live row: nothing to book against.
    expect(proposalIsBookable(proposal({ changeType: "REMOVE" }), null)).toBe(false);
  });
});

describe("laterApprovedConflict (#105 finding 1)", () => {
  const JAN = new Date("2026-01-10T00:00:00.000Z");
  const FEB = new Date("2026-02-10T00:00:00.000Z");
  const MAR = new Date("2026-03-10T00:00:00.000Z");

  it("blocks a reopen that would revert a change order approved after it", () => {
    // The defect: reopenBlockers checked billing on the edited lines and
    // never asked whether another approved change order had since touched
    // them. Reopening CO #2 writes its old snapshot back over CO #4's
    // change; CO #4 still renders its delta, and the contract value
    // contradicts both.
    const blocker = laterApprovedConflict(FEB, [{ number: 4, appliedAt: MAR }]);
    expect(blocker).toContain("CO #4");
    expect(blocker).toContain("silently revert");
  });

  it("does not block on a change order approved BEFORE it", () => {
    // This one's snapshot was taken after CO #1 landed, so restoring it
    // restores the state CO #1 left. Nothing is lost.
    expect(laterApprovedConflict(FEB, [{ number: 1, appliedAt: JAN }])).toBeNull();
  });

  it("names every later change order once, in ascending order", () => {
    const blocker = laterApprovedConflict(JAN, [
      { number: 6, appliedAt: MAR },
      { number: 4, appliedAt: FEB },
      { number: 4, appliedAt: FEB },
    ]);
    expect(blocker).toContain("CO #4 and CO #6");
    expect(blocker).toContain("have since changed");
  });

  it("refuses when the order cannot be established", () => {
    // appliedAt is null on a change order approved before that column was
    // written. A false block costs a revision instead of a reopen; a false
    // allow silently rewrites a contract value — so "cannot tell" blocks.
    expect(laterApprovedConflict(null, [{ number: 4, appliedAt: JAN }])).not.toBeNull();
    expect(laterApprovedConflict(FEB, [{ number: 4, appliedAt: null }])).not.toBeNull();
  });

  it("says nothing when no other change order touched those lines", () => {
    expect(laterApprovedConflict(FEB, [])).toBeNull();
  });
});
