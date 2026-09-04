import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculatePayAppLineItem, payAppEntryError, type PayAppLineItemInput } from "./pay-application";

/**
 * #95 — stored materials could be billed twice, and the GC got invoiced
 * for it.
 *
 * InvoiceLineItem.materialsStoredValue is a per-period DELTA, and
 * billing.prisma documents the mechanism for moving value out of stored
 * once the material is installed: "enter a negative value in a later period
 * to move value out of 'stored' and an equal positive thisPeriodBilled to
 * move it into 'completed'". That mechanism was unreachable from both ends
 * — `min="0"` on the form input and a `> 0` filter in submitPayApplication
 * — so the only thing a foreman could do was bill the installed work and
 * leave the stored figure behind, which double-counts it.
 *
 * Store $40k on a $100k line, install it, bill $100k, and the continuation
 * sheet reads $140,000 against a $100,000 line — 140% complete, on a
 * document already sent to the GC. Across the two applications the sub
 * demands $126,000 for a $100,000 line.
 *
 * lib/pay-application.ts had ZERO test coverage before this file.
 *
 * BE HONEST ABOUT WHAT THE GUARD IS. `payAppEntryError` is a CAP, not a
 * double-bill detector. It refuses an entry that drives a line past its
 * scheduled value and one that releases more stored material than was ever
 * stored. It does NOT and cannot catch the same double-count below 100% —
 * store $40k on a $100k line and then bill $50k of installed work without
 * the negative, and the line reads $90,000, under the cap, no refusal, and
 * the GC is billed for material it already paid for. Nothing in the data
 * distinguishes that from legitimately billing $50k of other work. The
 * thing that actually prevents it is the running "stored to date" figure
 * now shown beside the input, so the person entering it can see the $40,000
 * that is sitting there. Test 6 pins that the hint exists.
 */

const LINE = { lineItemId: "l1", description: "Metal stud framing", scheduledValue: 100000 };

describe("payAppEntryError", () => {
  it("refuses the double bill this guard exists to refuse", () => {
    const input: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled: 100000,
      previousMaterialsStored: 40000,
      materialsStoredValue: 0,
    };

    // Pin the wrong number first, so the trigger is unmistakable. This half
    // describes today's behaviour and passes before the fix.
    const wrong = calculatePayAppLineItem(input);
    expect(wrong.totalCompletedAndStoredToDate).toBe(140000);
    expect(wrong.percentOfScheduledValue).toBe(1.4);
    expect(wrong.balanceToFinish).toBe(-40000);

    const error = payAppEntryError(input);
    expect(error).toMatch(/scheduled value/i);
    // Naming the line and both numbers is the whole difference between an
    // error a PM can act on and "Prova won't let me bill".
    expect(error).toContain("Metal stud framing");
    expect(error).toContain("$140,000.00");
    expect(error).toContain("$100,000.00");
    // The honest remedy when the work really was performed: an approved
    // change order raises the line, because an approved CO mutates
    // JobLineItem directly.
    expect(error).toMatch(/change order/i);
  });

  it("lands the line at exactly 100% down the documented release path", () => {
    const input: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled: 100000,
      previousMaterialsStored: 40000,
      materialsStoredValue: -40000,
    };

    expect(payAppEntryError(input)).toBeNull();

    const row = calculatePayAppLineItem(input);
    expect(row.materialsStoredToDate).toBe(0);
    expect(row.totalCompletedAndStoredToDate).toBe(100000);
    expect(row.percentOfScheduledValue).toBe(1);
    expect(row.balanceToFinish).toBe(0);
  });

  it("refuses releasing more stored material than was ever stored", () => {
    const input: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled: 10000,
      previousMaterialsStored: 40000,
      materialsStoredValue: -50000,
    };

    expect(calculatePayAppLineItem(input).materialsStoredToDate).toBe(-10000);
    expect(payAppEntryError(input)).toMatch(/stored/i);
  });

  it("refuses a negative billed amount, which has no mechanism behind it", () => {
    // min="0" on the thisPeriodBilled input is a client-side claim only; a
    // crafted POST goes straight past it and Number("-5000") parses fine.
    // Unlike materialsStoredValue there is no negative-billing concept, so
    // this is enforced rather than merely decorated.
    const input: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled: -5000,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    };

    expect(payAppEntryError(input)).toMatch(/negative/i);
  });

  it("does not measure an unpriced line against a zero scheduled value", () => {
    // unitPrice is nullable: a cost-only or GC-furnished line legitimately
    // has no contract value, and pay-application.ts already returns null
    // percent for it — nothing to divide by. Without the scheduledValue > 0
    // condition in the guard, every unpriced line becomes unbillable.
    const input: PayAppLineItemInput = {
      lineItemId: "l2",
      description: "GC-furnished hoisting",
      scheduledValue: 0,
      previousBilled: 0,
      thisPeriodBilled: 5000,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    };

    expect(payAppEntryError(input)).toBeNull();
    expect(calculatePayAppLineItem(input).percentOfScheduledValue).toBeNull();
  });

  it("tolerates half a cent, because scheduledValue is a float product", () => {
    // NOT decorative, and the first version of this test failed to pin it.
    // scheduledValue is Number(quantity) * Number(unitPrice), computed as a
    // float: 114 LF at $3.40 is 387.59999999999996589, while the UI shows
    // $387.60 and that is what a foreman types to close the line out at
    // 100%. With no tolerance the typed figure is GREATER than the computed
    // scheduled value and the final billing on the line is refused, with an
    // error quoting two numbers that print identically.
    const scheduledValue = 114 * 3.4;
    expect(scheduledValue).toBeLessThan(387.6);

    const closeout: PayAppLineItemInput = {
      lineItemId: "l3",
      description: '5/8" Type X board — Level 3',
      scheduledValue,
      previousBilled: 0,
      thisPeriodBilled: 387.6,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    };
    expect(payAppEntryError(closeout)).toBeNull();

    // A real overage — a cent past the line — is still refused. The
    // tolerance is half a cent, not a licence.
    const at = (thisPeriodBilled: number): PayAppLineItemInput => ({
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    });
    expect(payAppEntryError(at(99999.99))).toBeNull();
    expect(payAppEntryError(at(100000))).toBeNull();
    expect(payAppEntryError(at(100000.01))).toMatch(/scheduled value/i);
  });

  it("still refuses a correcting application that over-releases, but allows one that nets negative", () => {
    // A pure credit — releasing stored material the sub was over-billed for
    // — has to stay possible. There is no void, edit or delete invoice
    // action anywhere in billing.ts, so a LATER application carrying the
    // negative is the only in-app way to correct an already-sent 140%
    // invoice. A blanket "invoice amount cannot be negative" refusal would
    // close that door; it is deliberately not implemented.
    const credit: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 100000,
      thisPeriodBilled: 0,
      previousMaterialsStored: 40000,
      materialsStoredValue: -40000,
    };

    expect(payAppEntryError(credit)).toBeNull();
    expect(calculatePayAppLineItem(credit).totalCompletedAndStoredToDate).toBe(100000);
  });
});

/**
 * Static guards, following the readFileSync precedent in
 * page-money-guards.test.ts. These do not execute the form or the action —
 * what they catch is the realistic regression, somebody restoring the
 * attribute or the filter that made the documented mechanism unreachable,
 * with every other test still green.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the negative-materials path stays reachable", () => {
  const form = read("components/PayApplications.tsx");

  /** The 200 characters of markup immediately before a named input. */
  const attributesBefore = (name: string) => {
    const at = form.indexOf(`name="${name}"`);
    expect(at).toBeGreaterThan(-1);
    return form.slice(Math.max(0, at - 200), at);
  };

  it("does not put min=0 on the stored-materials input", () => {
    expect(attributesBefore("materialsStoredValue")).not.toContain('min="0"');
  });

  it("DOES keep min=0 on this period's billed amount", () => {
    // Guards against a fix that strips both. There is no negative-billing
    // mechanism; only stored materials get released with a negative.
    expect(attributesBefore("thisPeriodBilled")).toContain('min="0"');
  });

  it("shows the running stored-to-date figure beside the input", () => {
    // Load-bearing, not polish: the form otherwise shows only "Scheduled
    // value", so a foreman has no way to see the $40,000 sitting stored on
    // the line, which is the single thing that makes the negative usable —
    // and the only defence against the sub-100% double-count the cap
    // cannot catch.
    expect(form).toContain("materialsStoredToDate");
  });

  it("renders the action's returned error rather than a thrown message", () => {
    // Production REDACTS thrown Server Action messages, so a guard that
    // throws shows a digest and the $140,000 goes out anyway.
    expect(form).toMatch(/result\.ok/);
    // ...and keeps the catch: requireCompanyContext, assertJobInCompany,
    // assertLineItemOnJob and Prisma all still throw.
    expect(form).toContain("catch");
  });
});

describe("submitPayApplication keeps negative rows", () => {
  const source = read("lib/actions/billing.ts");

  it("no longer drops a row whose only content is a negative", () => {
    expect(source).not.toContain("row.thisPeriodBilled > 0 || row.materialsStoredValue > 0");
  });

  it("calls the guard", () => {
    expect(source).toContain("payAppEntryError");
  });
});
