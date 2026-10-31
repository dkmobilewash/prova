import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProjectRow } from "@/lib/bid-project-view";
import { BidProjectOutcomes } from "./BidProjectOutcomes";

/**
 * One project's heading: name, bid date and, per GC, status and price. These
 * are the words a person reads, so they are checked as words.
 */

const dec = (n: number) => ({ toString: () => String(n) });

function project(over: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "p1",
    name: "Mercy Hospital Tower B",
    siteAddress: null,
    siteCity: null,
    owner: null,
    architect: null,
    bidDueDate: new Date("2026-11-04T00:00:00.000Z"),
    primeAwardedContactId: null,
    primeAwardedName: null,
    primeAwardedOn: null,
    primeAwardedContact: null,
    estimateJob: { id: "job1", name: "Tower B", lineItems: [{ quantity: dec(1000), unitPrice: dec(10) }, { quantity: dec(200), unitPrice: dec(5) }] },
    invitations: [
      { id: "i1", contactId: "acme", status: "SUBMITTED", bidAmount: dec(11000), contact: { name: "Acme GC" } },
      {
        id: "i2",
        contactId: "buildco",
        status: "INVITED",
        bidAmount: null,
        contact: { name: "BuildCo" },
        priceAdjustPercent: dec(-5),
        priceAdjustReason: "second job for them",
      },
      { id: "i3", contactId: "turner", status: "INVITED", bidAmount: null, contact: { name: "Turner" }, priceAdjustAmount: dec(1500) },
    ],
    ...over,
  };
}

const text = (p: ProjectRow) =>
  renderToStaticMarkup(createElement(BidProjectOutcomes, { project: p }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("BidProjectOutcomes", () => {
  it("names the project and its bid date, with the estimate total", () => {
    const words = text(project());
    expect(words).toContain("Mercy Hospital Tower B");
    expect(words).toContain("Bid date 11/4/2026");
    expect(words).toContain("Estimate $11,000.00");
  });

  it("shows every GC's status and price: sent, or quoted off the estimate", () => {
    const words = text(project());
    expect(words).toContain("Acme GC Submitted $11,000.00 sent");
    expect(words).toContain("BuildCo Invited $10,450.00 quoted · −5%");
    expect(words).toContain("Turner Invited $12,500.00 quoted · +$1,500.00");
  });

  it("when what was sent differs from what the estimate quotes, both are said", () => {
    const row = project();
    row.invitations[0].bidAmount = dec(10900);
    expect(text(row)).toContain("$10,900.00 sent (quoted $11,000.00)");
  });

  it("a GC the prime went elsewhere on reads Didn't get the job, never Lost", () => {
    const words = text(project({ primeAwardedContactId: "buildco" }));
    expect(words).toContain("Acme GC Didn't get the job");
    expect(words).toContain("Turner Didn't get the job");
    expect(words).toContain("BuildCo Invited");
    expect(words).not.toContain("Lost");
  });

  it("no estimate yet: no estimate total and no invented price", () => {
    const words = text(project({ estimateJob: null }));
    expect(words).not.toContain("Estimate $");
    expect(words).toContain("BuildCo Invited no price yet");
    expect(words).toContain("Acme GC Submitted $11,000.00 sent");
  });

  it("an adjustment that no longer makes a price is flagged, not printed as a number", () => {
    const row = project();
    row.invitations[2].priceAdjustAmount = dec(-99999);
    expect(text(row)).toContain("Turner Invited check the adjustment");
  });

  it("no bid date says so", () => {
    expect(text(project({ bidDueDate: null }))).toContain("No bid date");
  });
});
