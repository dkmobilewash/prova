import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calculatePayAppLineItem,
  payAppEntryError,
  thisPeriodForPercentComplete,
  type PayAppLineItemInput,
} from "./pay-application";

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

  it("refuses taking back more than the line was ever billed", () => {
    // THIS TEST SAID THE OPPOSITE UNTIL 2026-09-21, and the sentence it
    // asserted — "there is no negative-billing concept" — was what kept an
    // over-billed line uncorrectable. It is not true of a CORRECTION. Column
    // E of a G703 goes negative to take back an over-bill, and this app has
    // no void, edit or delete invoice action to do it any other way.
    //
    // What survives is the bound. $5,000 taken back off a line that has
    // never been billed a cent leaves it at −$5,000 completed to date, which
    // is not a figure a continuation sheet can carry.
    const beyondWhatWasBilled: PayAppLineItemInput = {
      ...LINE,
      previousBilled: 0,
      thisPeriodBilled: -5000,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    };

    const error = payAppEntryError(beyondWhatWasBilled);
    // Both figures named, so a PM can see which one is wrong rather than
    // being told the entry is invalid.
    expect(error).toContain("$5,000.00");
    expect(error).toContain("$0.00");
    expect(error).toContain("Metal stud framing");
  });

  it("allows a correction down to exactly what the line has been billed, and no further", () => {
    const correcting = (thisPeriodBilled: number): PayAppLineItemInput => ({
      ...LINE,
      previousBilled: 60000,
      thisPeriodBilled,
      previousMaterialsStored: 0,
      materialsStoredValue: 0,
    });

    // The real case: $60,000 claimed in March where $50,000 was built.
    expect(payAppEntryError(correcting(-10000))).toBeNull();
    expect(calculatePayAppLineItem(correcting(-10000)).totalCompletedAndStoredToDate).toBe(50000);

    // All the way back to zero is legitimate — a line billed entirely in
    // error is reversed in full.
    expect(payAppEntryError(correcting(-60000))).toBeNull();
    expect(calculatePayAppLineItem(correcting(-60000)).totalCompletedAndStoredToDate).toBe(0);

    // A cent past it is not. The half-cent tolerance is for float dust in
    // scheduledValue, not a licence here either.
    expect(payAppEntryError(correcting(-60000.01))).toMatch(/more than/i);
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

  it("leaves a correcting application that nets negative acceptable at the ROW level", () => {
    // A pure credit — releasing stored material the sub was over-billed for
    // — has to stay possible. There is no void, edit or delete invoice
    // action anywhere in billing.ts, so a LATER application carrying the
    // negative is the only in-app way to correct an already-sent 140%
    // invoice.
    //
    // THIS COMMENT USED TO END "a blanket 'invoice amount cannot be
    // negative' refusal would close that door; it is deliberately not
    // implemented", AND THAT ABSENCE TURNED OUT TO COST SOMETHING. With no
    // document-level check of any kind, the same shape reached by mistake —
    // the −$5,000 stored release with its matching positive left off —
    // produced a −$5,000.00 invoice, a −$500.00 retainage snapshot and a
    // G702 reading "Current payment due −$4,500.00", with every row here
    // returning null, correctly.
    //
    // The conclusion was right and the inference from it was wrong: a
    // blanket refusal WOULD close the door, so `submitPayApplication` asks
    // instead of refusing — a negative total needs the submission to say a
    // credit is what was meant. Nothing about the ROW guard changes, which
    // is what this test still pins. See lib/pay-application-credit.test.ts
    // for the document half, driven through the action.
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
/** COMMENTS ARE STRIPPED BEFORE ANY OF THIS IS SCANNED, and this file
 * needed it the moment the inputs below acquired a paragraph explaining
 * which floor went and why: that paragraph contains the literal `min="0"`,
 * sitting inside the 200 characters `attributesBefore` reads, so the
 * assertion that the attribute is gone failed on the note recording that it
 * had gone. The mirror image of #185, where a comment quoting a pattern
 * DISARMED a census. Either way a scan that reads prose is answering a
 * question about prose. Same helper `ownerRefusalCensus.test.ts` uses. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

describe("the negative-materials path stays reachable", () => {
  const form = read("components/PayApplications.tsx");

  /**
   * THE WHOLE `<input …/>` TAG a named field sits in — both sides of the
   * `name`, not the 200 characters before it.
   *
   * It read `form.slice(at - 200, at)`, and mutation testing caught that
   * going vacuous: putting `type="number" min="0"` back on the This-period
   * box left every assertion here GREEN. #414 reordered these inputs to put
   * `name` FIRST, so the attributes each assertion is about had moved
   * behind the anchor it measured from and there was nothing to find. The
   * window was never wrong about anything — it had stopped looking at the
   * attributes at all, which is the failure mode this repo keeps paying
   * for: a check answering a question nobody asked.
   *
   * Reading the tag has no window to get wrong, and it fails loudly if the
   * markup ever stops being a self-closing input.
   */
  const attributesOf = (name: string) => {
    const at = form.indexOf(`name="${name}"`);
    expect(at, `no input named ${name}`).toBeGreaterThan(-1);
    const open = form.lastIndexOf("<input", at);
    const close = form.indexOf("/>", at);
    expect(open, `no opening <input before name="${name}"`).toBeGreaterThan(-1);
    expect(close, `no closing /> after name="${name}"`).toBeGreaterThan(open);
    return form.slice(open, close + 2);
  };

  it("does not put min=0 on the stored-materials input", () => {
    expect(attributesOf("materialsStoredValue")).not.toContain('min="0"');
    expect(attributesOf("materialsStoredValue")).toContain('type="text"');
  });

  it("keeps NO floor on this period's billed amount — the third state of this assertion", () => {
    // THIS TEST HAS NOW SAID THREE DIFFERENT THINGS, and the sequence is
    // worth more than any one of them:
    //
    //   1. "DOES keep min=0" — the markup attribute, against a fix that
    //      stripped both boxes. Guarding #95's release mechanism.
    //   2. #414 moved the floor into the ACTION as `{ min: 0 }`, because
    //      native validation gates the submit handler and so refused in
    //      silence. Same rule, better placed, and this test followed it.
    //   3. The rule itself was wrong. Every version rested on "there is no
    //      negative-billing mechanism", which is true of the stored-material
    //      RELEASE and false of a downward CORRECTION — and nobody had asked
    //      about corrections. A line over-billed in March could not be
    //      brought down on any later application, by any route, ever. A
    //      G703's column E is that route.
    //
    // So the floor is gone from both places, and what replaced it is a BOUND
    // rather than nothing: you cannot un-bill more than the line has been
    // billed. Enforced on the server, where a crafted POST meets it too.
    const parse = read("lib/pay-application.ts");
    expect(attributesOf("thisPeriodBilled")).not.toContain('min="0"');
    // #414's measurement stands and must keep standing: type="number"
    // discards a thousands comma before the server sees it, and Firefox
    // submits an empty string for anything it dislikes.
    expect(attributesOf("thisPeriodBilled")).not.toContain('type="number"');
    // Positive as well as negative: an assertion that only ever says what
    // is ABSENT passes just as happily over an input that has stopped
    // existing, or over a window that has stopped containing it.
    expect(attributesOf("thisPeriodBilled")).toContain('type="text"');
    expect(attributesOf("thisPeriodBilled")).toContain('inputMode="decimal"');
    expect(parse).toContain('payAppFigure(thisPeriodValues[i], "This period")');
    expect(parse).not.toMatch(/payAppFigure\(thisPeriodValues\[i\], "This period", \{ min: 0 \}\)/);
    // Stored never had one, which was the whole point of the pair; now they
    // agree, for two different reasons that happen to land in the same place.
    expect(parse).toContain('payAppFigure(materialsStoredValues[i], "Stored materials")');
    // And the bound that replaced the floor is real, not merely absent.
    expect(parse).toContain("input.previousBilled + input.thisPeriodBilled < -CENT_TOLERANCE");
  });

  it("reads the grid through one parse, shared by the form and the action", () => {
    // #414 wrote the per-cell parser inside submitPayApplication. It moved to
    // lib/pay-application.ts UNCHANGED so the form can show a running total
    // from the same reading the server decides on — a second expression here
    // would be a preview free to disagree with the write.
    expect(read("lib/actions/billing.ts")).toContain("payAppRowsFromForm(formData)");
    expect(form).toContain("payAppRowsFromForm");
    expect(read("lib/actions/billing.ts")).not.toContain("function payApplicationFigure");
  });

  it("shows what the application comes to, and asks before submitting a credit", () => {
    // The document-level half of the negative-pay-application defect. The
    // total was never on screen at all, so an application could net negative
    // without the figure ever appearing — and `confirmCredit` is what
    // `submitPayApplication` requires before writing one.
    expect(form).toContain("This application comes to");
    expect(form).toContain('name="confirmCredit"');
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
    // The parse moved into pay-application.ts (one reading of the boxes,
    // shared with the form), so the filter is checked THERE now — a check
    // pointed at the file the code left is a check that has stopped
    // looking, and it would keep passing forever.
    const parse = read("lib/pay-application.ts");
    expect(parse).not.toContain("row.thisPeriodBilled > 0 || row.materialsStoredValue > 0");
    // #414 rewrote the drop as a `continue` inside the parse loop, so the
    // shape to pin is that one — and what matters about it is unchanged:
    // BOTH cells must be zero. `&&`, never `||`, or a row carrying only the
    // negative release vanishes and #95's double bill is back.
    expect(parse).toContain("if (billed.n === 0 && stored.n === 0) continue;");
    expect(source).toContain("payAppRowsFromForm");
  });

  it("calls the guard", () => {
    expect(source).toContain("payAppEntryError");
  });

  it("refuses a negative TOTAL that does not say it is a credit", () => {
    // The per-row guard above cannot see this: each row is fine and the
    // certificate is not. Pinned as source rather than behaviour only
    // because the behaviour is already executed against the real action in
    // lib/pay-application-credit.test.ts — this catches the edit that
    // deletes the condition while that file's mocks still satisfy it.
    expect(source).toContain('formData.get("confirmCredit")');
    expect(source).toMatch(/Number\(amountValue\)\s*<\s*0/);
  });
});

/**
 * Percent complete -> This period.
 *
 * The prompt this came from: "Do the pay app for Riverside. We're at 60% on
 * framing, 35% on board, 10% on tape, nothing on ACT yet." Every figure a
 * sub says about progress is a percentage; every figure the G703 wants is
 * dollars. Somebody converts, per line, every month, on a calculator that
 * does not know what was billed last period.
 *
 * THESE TESTS PIN THE ROUND TRIP, NOT THE ARITHMETIC. Asserting that 60% of
 * $200,000 is $120,000 re-states the expression; it would pass just as
 * happily if the result disagreed with the form it feeds. What has to hold
 * is that entering this figure makes `percentOfScheduledValue` — the G703's
 * own column G — read back the percent that was asked for. So each case
 * computes a figure, feeds it through `calculatePayAppLineItem`, and checks
 * the percent it lands at.
 */
describe("percent complete converts to this period's dollars", () => {
  const line = (over: Partial<PayAppLineItemInput> = {}): PayAppLineItemInput => ({
    lineItemId: "l1",
    description: "Framing",
    scheduledValue: 200_000,
    previousBilled: 0,
    thisPeriodBilled: 0,
    previousMaterialsStored: 0,
    materialsStoredValue: 0,
    ...over,
  });

  /** The contract, run for real: convert, enter, read the percent back. */
  function landsAt(percent: number, over: Partial<PayAppLineItemInput> = {}) {
    const base = line(over);
    const materialsStoredToDate = base.previousMaterialsStored + base.materialsStoredValue;
    const converted = thisPeriodForPercentComplete({
      percentComplete: percent,
      scheduledValue: base.scheduledValue,
      previousBilled: base.previousBilled,
      materialsStoredToDate,
    });
    if (!converted.ok) throw new Error(`expected a figure, got: ${converted.error}`);
    const entered = calculatePayAppLineItem({ ...base, thisPeriodBilled: converted.result.thisPeriodBilled });
    return { ...converted.result, entered };
  }

  it("bills the percentage on a line nothing has been billed against", () => {
    const { thisPeriodBilled, entered } = landsAt(60);
    expect(thisPeriodBilled).toBe(120_000);
    expect(entered.percentOfScheduledValue).toBeCloseTo(0.6, 10);
  });

  it("bills only the DIFFERENCE when the line was billed last period", () => {
    // The half a calculator gets wrong: 60% of the line is $120,000, but
    // $75,000 of it went out in September, so this period is $45,000 — not
    // $120,000 again, which is how a line reaches 90% complete on a job
    // that is 60% built.
    const { thisPeriodBilled, entered } = landsAt(60, { previousBilled: 75_000 });
    expect(thisPeriodBilled).toBe(45_000);
    expect(entered.percentOfScheduledValue).toBeCloseTo(0.6, 10);
  });

  it("counts stored materials toward the percent, the way column G does", () => {
    // $40,000 sitting in the yard on a $200,000 line is already 20% of the
    // line by the form's own definition, so reaching 60% bills $80,000 of
    // work rather than $120,000. Stated out loud this is the surprising
    // one, which is why it is a test and a paragraph in the source.
    const { thisPeriodBilled, entered } = landsAt(60, { previousMaterialsStored: 40_000 });
    expect(thisPeriodBilled).toBe(80_000);
    expect(entered.percentOfScheduledValue).toBeCloseTo(0.6, 10);
  });

  it("returns a negative for a percent BELOW what was already billed", () => {
    // A downward correction, which payAppEntryError documents as the only
    // route back on an over-billed line: 70% went out, the real figure is
    // 60%, so this period carries -$20,000 and column G comes down.
    const { thisPeriodBilled, entered } = landsAt(60, { previousBilled: 140_000 });
    expect(thisPeriodBilled).toBe(-20_000);
    expect(entered.percentOfScheduledValue).toBeCloseTo(0.6, 10);
    // And it is still a legal entry — the bound belongs to the gate, not here.
    expect(payAppEntryError({ ...line({ previousBilled: 140_000 }), thisPeriodBilled })).toBeNull();
  });

  it("takes a line to exactly 100% without drifting a cent over", () => {
    // A third of an odd number, three times: the case where rounding to the
    // cent either lands the line on its contract value or leaves it at
    // 100.0001% and trips the over-billing gate on the final application.
    const scheduledValue = 100_000 / 3;
    const first = landsAt(33.33, { scheduledValue });
    const second = landsAt(66.66, { scheduledValue, previousBilled: first.thisPeriodBilled });
    const final = landsAt(100, {
      scheduledValue,
      previousBilled: first.thisPeriodBilled + second.thisPeriodBilled,
    });
    const billed = first.thisPeriodBilled + second.thisPeriodBilled + final.thisPeriodBilled;
    expect(billed).toBeCloseTo(scheduledValue, 2);
    expect(final.entered.percentOfScheduledValue).toBeCloseTo(1, 6);
    expect(
      payAppEntryError({
        ...line({ scheduledValue, previousBilled: first.thisPeriodBilled + second.thisPeriodBilled }),
        thisPeriodBilled: final.thisPeriodBilled,
      }),
      "the last application on a line must not trip the over-billing gate",
    ).toBeNull();
  });

  it("bills nothing at 0%, rather than treating it as nothing said", () => {
    // "nothing on ACT yet" is a real statement about a line, and it must
    // come back as a figure of zero rather than an error — the caller
    // decides whether a zero row is worth submitting.
    const converted = thisPeriodForPercentComplete({
      percentComplete: 0,
      scheduledValue: 50_000,
      previousBilled: 0,
      materialsStoredToDate: 0,
    });
    expect(converted.ok && converted.result.thisPeriodBilled).toBe(0);
  });

  it("refuses a percent over 100 in the words it was said in", () => {
    const converted = thisPeriodForPercentComplete({
      percentComplete: 110,
      scheduledValue: 200_000,
      previousBilled: 0,
      materialsStoredToDate: 0,
    });
    expect(converted.ok).toBe(false);
    expect(!converted.ok && converted.error).toMatch(/110% is more than the line is worth/);
    expect(!converted.ok && converted.error).toMatch(/change order/);
  });

  it("refuses a line with no contract value rather than dividing by zero", () => {
    const converted = thisPeriodForPercentComplete({
      percentComplete: 60,
      scheduledValue: 0,
      previousBilled: 0,
      materialsStoredToDate: 0,
    });
    expect(converted.ok).toBe(false);
    expect(!converted.ok && converted.error).toMatch(/no contract value/);
  });

  it("refuses a negative percent, and says how to go backwards instead", () => {
    const converted = thisPeriodForPercentComplete({
      percentComplete: -5,
      scheduledValue: 200_000,
      previousBilled: 0,
      materialsStoredToDate: 0,
    });
    expect(converted.ok).toBe(false);
    expect(!converted.ok && converted.error).toMatch(/lower percent than last time/);
  });

  it("hands back where the line LANDS, so a 0.6-for-60 slip is visible", () => {
    // The one mistake the type cannot prevent: this takes 0-100, and a 0-1
    // ratio passed into it is a valid, tiny, plausible-looking percentage.
    // $1,200 on a $200,000 line is not obviously wrong; "this takes the
    // line to 0.6%" is. That is why the result carries it.
    const converted = thisPeriodForPercentComplete({
      percentComplete: 0.6,
      scheduledValue: 200_000,
      previousBilled: 0,
      materialsStoredToDate: 0,
    });
    expect(converted.ok && converted.result.thisPeriodBilled).toBe(1_200);
    expect(converted.ok && converted.result.landsAtPercent).toBeCloseTo(0.6, 10);
  });
});
