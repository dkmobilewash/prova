import { describe, expect, it } from "vitest";
import {
  WAIVER_FORM_LABELS,
  candidateExceptionTotal,
  candidateExceptions,
  waiverFormLabel,
  waiverWarnings,
  type WarningInput,
} from "./lien-waiver";

/**
 * The expensive failure this file guards is not picking the wrong form.
 * It is an UNCONDITIONAL waiver with the exceptions left blank, which
 * gives up retainage and every pending change order along with the
 * payment actually being made — a document that reads as routine
 * paperwork and costs the held percentage of the job.
 *
 * So most of what is asserted here is the SENTENCES. A warning nobody can
 * act on is decoration, and a warning that reassures is worse than none.
 */

const base: WarningInput = {
  condition: "CONDITIONAL",
  stage: "PROGRESS",
  exceptedAmount: 0,
  amountPaid: null,
  retainageBalance: 0,
  pendingChangeOrderTotal: 0,
};

describe("the four forms", () => {
  it("names all four, and they are distinct", () => {
    const labels = Object.values(WAIVER_FORM_LABELS);
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size, "two forms share a label").toBe(4);
  });

  it("maps every combination of the two axes", () => {
    // The reason this is two enums and not one four-valued one: every
    // pairing is a real document, so there is nothing to rule out.
    for (const condition of ["CONDITIONAL", "UNCONDITIONAL"] as const) {
      for (const stage of ["PROGRESS", "FINAL"] as const) {
        expect(waiverFormLabel(condition, stage), `${condition}/${stage}`).toBeTruthy();
      }
    }
  });

  it("says conditional or unconditional in the name, since that is the whole distinction", () => {
    expect(waiverFormLabel("CONDITIONAL", "PROGRESS").toLowerCase()).toContain("conditional");
    expect(waiverFormLabel("UNCONDITIONAL", "FINAL").toLowerCase()).toContain("unconditional");
  });
});

describe("candidate exceptions are offered, never applied", () => {
  it("finds retainage and pending change orders", () => {
    const found = candidateExceptions({ retainageBalance: 5000, pendingChangeOrderTotal: 1200 });
    expect(found.map((c) => c.key)).toEqual(["retainage", "pending-change-orders"]);
    expect(candidateExceptionTotal({ retainageBalance: 5000, pendingChangeOrderTotal: 1200 })).toBe(6200);
  });

  it("omits a zero candidate rather than listing it at $0.00", () => {
    // "Retainage: $0.00" beside the field is noise, and noise beside a
    // money field trains people to stop reading it.
    expect(candidateExceptions({ retainageBalance: 0, pendingChangeOrderTotal: 900 }).map((c) => c.key)).toEqual([
      "pending-change-orders",
    ]);
    expect(candidateExceptions({ retainageBalance: 0, pendingChangeOrderTotal: 0 })).toEqual([]);
  });
});

describe("warnings", () => {
  it("says nothing when there is nothing to say", () => {
    expect(waiverWarnings(base)).toEqual([]);
  });

  it("NEVER REASSURES — silence is not an all-clear", () => {
    // The load-bearing test of this module. A waiver can be catastrophic
    // for reasons this app cannot see: a side agreement, a second-tier
    // claim, a statute wanting a form nobody here has heard of. If a
    // message ever tells somebody it is fine to sign, that sentence is
    // the app giving legal comfort it has no basis for.
    const everyMessage = [
      ...waiverWarnings(base),
      ...waiverWarnings({ ...base, condition: "UNCONDITIONAL", amountPaid: 0 }),
      ...waiverWarnings({ ...base, stage: "FINAL", retainageBalance: 100 }),
      ...waiverWarnings({ ...base, retainageBalance: 100, pendingChangeOrderTotal: 50 }),
    ].map((w) => w.message.toLowerCase());

    for (const message of everyMessage) {
      for (const reassurance of ["safe to sign", "looks good", "no issues", "you're covered", "all clear", "ok to sign"]) {
        expect(message, `a warning must never reassure: "${reassurance}"`).not.toContain(reassurance);
      }
    }
  });

  it("flags an unconditional waiver with no payment recorded", () => {
    const [warning] = waiverWarnings({ ...base, condition: "UNCONDITIONAL", amountPaid: 0 });
    expect(warning.key).toBe("unconditional-without-payment");
    // It has to offer the alternative, or it is just a scold.
    expect(warning.message).toContain("conditional waiver");
  });

  it("stays silent about payment when no invoice is attached", () => {
    // `null` means the app has nothing to check. Warning about an absence
    // it cannot interpret would be noise on every closeout waiver.
    expect(waiverWarnings({ ...base, condition: "UNCONDITIONAL", amountPaid: null })).toEqual([]);
  });

  it("does not flag an unconditional waiver that has been paid", () => {
    expect(waiverWarnings({ ...base, condition: "UNCONDITIONAL", amountPaid: 12_500 })).toEqual([]);
  });

  it("flags a FINAL waiver while retainage is outstanding", () => {
    const warnings = waiverWarnings({ ...base, stage: "FINAL", retainageBalance: 8_000, exceptedAmount: 8_000 });
    const final = warnings.find((w) => w.key === "final-with-retainage");
    expect(final, "a final waiver with retainage held must say so").toBeDefined();
    expect(final!.message).toContain("$8,000.00");
  });

  it("flags a FINAL waiver with retainage EVEN WHEN the exceptions cover it", () => {
    // Deliberate. The excepted figure is a number typed today; the
    // retainage balance moves, and the waiver does not. Covering it is
    // not the same as it being safe.
    const warnings = waiverWarnings({ ...base, stage: "FINAL", retainageBalance: 8_000, exceptedAmount: 99_000 });
    expect(warnings.map((w) => w.key)).toContain("final-with-retainage");
  });

  it("flags exceptions that fall short, and names what is missing and by how much", () => {
    const warnings = waiverWarnings({ ...base, retainageBalance: 5_000, pendingChangeOrderTotal: 1_200, exceptedAmount: 0 });
    const short = warnings.find((w) => w.key === "exceptions-short");
    expect(short).toBeDefined();
    // Both sources named, with their amounts — "your exceptions are too
    // low" is not something anybody can act on.
    expect(short!.message).toContain("$5,000.00");
    expect(short!.message).toContain("$1,200.00");
    expect(short!.message.toLowerCase()).toContain("retainage");
    expect(short!.message.toLowerCase()).toContain("change orders");
  });

  it("is satisfied once the exceptions cover the candidates", () => {
    const warnings = waiverWarnings({ ...base, retainageBalance: 5_000, pendingChangeOrderTotal: 1_200, exceptedAmount: 6_200 });
    expect(warnings.map((w) => w.key)).not.toContain("exceptions-short");
  });

  it("puts the worst first, because the first line is the one that gets read", () => {
    const warnings = waiverWarnings({
      ...base,
      condition: "UNCONDITIONAL",
      stage: "FINAL",
      amountPaid: 0,
      retainageBalance: 5_000,
      exceptedAmount: 0,
    });
    expect(warnings.map((w) => w.key)).toEqual([
      "final-with-retainage",
      "unconditional-without-payment",
      "exceptions-short",
    ]);
  });

  it("never blocks — it returns sentences, and a caller can always proceed", () => {
    // Encoded as a type-level and shape-level fact: the worst case still
    // returns an array of messages, never a refusal, never a throw.
    const worst = () =>
      waiverWarnings({
        condition: "UNCONDITIONAL",
        stage: "FINAL",
        amountPaid: 0,
        exceptedAmount: 0,
        retainageBalance: 50_000,
        pendingChangeOrderTotal: 9_000,
      });
    expect(worst).not.toThrow();
    expect(worst()).toHaveLength(3);
  });
});
