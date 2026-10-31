import { describe, expect, it } from "vitest";
import { installedDayText, installedFieldName, installedFromForm, installedToDateText, isInstallable, parseInstalled } from "./installed-quantities";

describe("which lines take a quantity", () => {
  it.each([
    [{ unit: "SF", quantity: 10000 }, true],
    [{ unit: "LF", quantity: 5, costCategory: "MATERIAL" }, true],
    [{ unit: "LS", quantity: 1 }, false],
    [{ unit: "Lump Sum", quantity: 1 }, false],
    [{ unit: null, quantity: 10 }, false],
    [{ unit: " ", quantity: 10 }, false],
    [{ unit: "SF", quantity: 0 }, false],
    [{ unit: "HR", quantity: 200, costCategory: "LABOR" }, false],
  ])("%j is %s", (line, expected) => expect(isInstallable(line)).toBe(expected));
});

describe("reading what was typed", () => {
  it("drops blanks and zeros, and takes a comma decimal", () => {
    expect(
      parseInstalled([
        { lineItemId: "a", quantity: "400" },
        { lineItemId: "b", quantity: "" },
        { lineItemId: "c", quantity: "0" },
        { lineItemId: "d", quantity: "12,5" },
      ]),
    ).toEqual([{ lineItemId: "a", quantity: 400 }, { lineItemId: "d", quantity: 12.5 }]);
  });

  it("tells not sent from sent empty, because the first must leave a report alone", () => {
    expect(parseInstalled(undefined)).toBeUndefined();
    expect(parseInstalled([])).toEqual([]);
  });

  it("refuses what is not a figure, including a negative", () => {
    for (const quantity of ["-5", "lots", "1e3", "99999999"]) expect(parseInstalled([{ lineItemId: "a", quantity }])).toBeNull();
    expect(parseInstalled("nope")).toBeNull();
    expect(parseInstalled([{ quantity: "5" }])).toBeNull();
  });

  it("reads a form's boxes, and reports none when the form had none", () => {
    const form = new FormData();
    form.set("workPerformed", "Hung board");
    expect(installedFromForm(form)).toBeUndefined();
    form.set(installedFieldName("line1"), " 400 ");
    form.set(installedFieldName("line2"), "");
    expect(installedFromForm(form)).toEqual([{ lineItemId: "line1", quantity: "400" }, { lineItemId: "line2", quantity: "" }]);
  });
});

describe("the words", () => {
  it("says a total the same way everywhere", () => {
    expect(installedToDateText({ installedToDate: 1200, quantity: 10000, unit: "SF" })).toBe("1,200 of 10,000 SF to date");
    expect(installedDayText([{ quantity: 400.5, unit: "SF", description: "Board" }, { quantity: 20, unit: "LF", description: "Track" }])).toBe("400.5 SF Board · 20 LF Track");
  });
});
