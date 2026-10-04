import { describe, expect, it } from "vitest";
import {
  FRINGE_FIELDS,
  readMoney,
  readWageRateForm,
  type WageRateInput,
} from "./determination-wage-rate";

function form(fields: Record<string, string>) {
  return (key: string) => (key in fields ? fields[key] : null);
}

const GOOD = { classification: "Drywall Finisher/Taper", baseWage: "52.34" };

describe("figures copied off a PDF", () => {
  it("strips currency furniture rather than refusing it", () => {
    // Somebody pasting "$1,284.00" out of a determination is doing the
    // normal thing. Refusing it teaches them to retype a number they had
    // right, which is how a digit gets dropped.
    expect(readMoney("$52.34")).toBe(52.34);
    expect(readMoney("1,284.00")).toBe(1284);
    expect(readMoney(" $1,284.00 ")).toBe(1284);
  });

  it("tells blank apart from unreadable", () => {
    // Blank means "not on the document". Unreadable means somebody typed
    // something that is not a number. Collapsing them would silently store
    // null for a typo.
    expect(readMoney("")).toBeNull();
    expect(readMoney(null)).toBeNull();
    expect(readMoney("   ")).toBeNull();
    expect(Number.isNaN(readMoney("abc") as number)).toBe(true);
    expect(Number.isNaN(readMoney("12abc") as number)).toBe(true);
  });

  it("refuses a hex-looking paste that Number() would happily take", () => {
    // Number("0x10") is 16. A wage is not hex.
    expect(Number.isNaN(readMoney("0x10") as number)).toBe(true);
  });
});

describe("a base wage of zero is refused and a fringe of zero is kept", () => {
  it("refuses a zero base wage", () => {
    // THE REGRESSION, NAMED: no determination publishes a base rate of
    // nothing, so a 0 is a mis-key or an empty box read as a figure — and
    // it would price the work at nothing.
    const out = readWageRateForm(form({ ...GOOD, baseWage: "0" }));
    expect(out.ok, "a zero base wage was accepted — that prices work at nothing").toBe(false);
    if (!out.ok) expect(out.error).toMatch(/not a rate/i);
  });

  it("keeps a zero fringe, because that is an ordinary fact", () => {
    const out = readWageRateForm(form({ ...GOOD, trainingRate: "0" }));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.trainingRate, "a published zero training contribution was dropped").toBe(0);
    }
  });

  it("leaves an omitted fringe null rather than zero", () => {
    const out = readWageRateForm(form(GOOD));
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Null is "the document does not say"; 0 is "the document says none".
      for (const f of FRINGE_FIELDS) expect(out.value[f], `${f} defaulted to a number`).toBeNull();
    }
  });
});

describe("what it refuses", () => {
  it("requires a classification", () => {
    const out = readWageRateForm(form({ ...GOOD, classification: "   " }));
    expect(out.ok).toBe(false);
  });

  it("requires a base wage", () => {
    expect(readWageRateForm(form({ classification: "Taper" })).ok).toBe(false);
  });

  it("refuses negatives on the base and on every fringe", () => {
    expect(readWageRateForm(form({ ...GOOD, baseWage: "-3" })).ok).toBe(false);
    for (const f of FRINGE_FIELDS) {
      const out = readWageRateForm(form({ ...GOOD, [f]: "-1" }));
      expect(out.ok, `${f} accepted a negative`).toBe(false);
    }
  });

  it("names the field it refused, so the message is actionable", () => {
    const out = readWageRateForm(form({ ...GOOD, healthWelfareRate: "abc" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/health & welfare/i);
  });

  it("checks EVERY fringe, not just the first", () => {
    // SCOPE: a loop that returned after the first field would pass every
    // test above and still let a bad trainingRate through.
    const out = readWageRateForm(form({ ...GOOD, trainingRate: "abc" }));
    expect(out.ok, "a bad training rate was not reached").toBe(false);
  });
});

describe("an unmapped classification is a legitimate state", () => {
  it("stores null rather than refusing when no craft is picked", () => {
    const out = readWageRateForm(form(GOOD));
    expect(out.ok).toBe(true);
    // The document's classification names are not ours. Forcing a mapping
    // here would make somebody guess while copying a government document.
    if (out.ok) expect(out.value.craftClassificationId).toBeNull();
  });

  it("keeps the craft when one is picked", () => {
    const out = readWageRateForm(form({ ...GOOD, craftClassificationId: "craft_1" }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.craftClassificationId).toBe("craft_1");
  });

  it("trims the classification as typed", () => {
    const out = readWageRateForm(form({ ...GOOD, classification: "  Taper  " }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.classification).toBe("Taper");
  });
});

describe("the fringe list and the value shape agree", () => {
  it("has a field on the value for every fringe it parses", () => {
    const out = readWageRateForm(form(GOOD));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const value: WageRateInput = out.value;
    for (const f of FRINGE_FIELDS) {
      expect(Object.hasOwn(value, f), `${f} is parsed but not on the value`).toBe(true);
    }
    expect(FRINGE_FIELDS.length, "the fringe list emptied — every assertion above is vacuous").toBe(4);
  });
});
