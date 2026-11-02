// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EquipmentRatePicker } from "./EquipmentRatePicker";
import { renderToStaticMarkup } from "react-dom/server";
import type { EquipmentRateRow } from "@/lib/equipment-rates";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const lift: EquipmentRateRow = { id: "a", name: "Scissor lift", unit: "DAY", rate: 450, effectiveFrom: "2026-01-01", effectiveTo: null, notes: null };

describe("picking an equipment rate", () => {
  let form: HTMLFormElement;
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
  const pick = async (id: string) => {
    const select = form.querySelector("select[aria-label]") as HTMLSelectElement;
    await act(async () => {
      select.value = id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    form = document.createElement("form");
    form.innerHTML = `<input name="itemDescription"/><input name="unit"/><input name="budgetedUnitCost"/><input name="unitPrice"/>
      <select name="costCategory"><option value=""></option><option value="EQUIPMENT">e</option></select><div id="slot"></div>`;
    document.body.append(form);
    await act(async () => {
      createRoot(form.querySelector("#slot")!).render(createElement(EquipmentRatePicker, { rates: [lift], day: "2026-10-20" }));
    });
  });
  afterEach(() => form.remove());

  it("fills the boxes, leaves the price blank for the recap, and everything stays editable", async () => {
    await pick("a");
    expect([value("itemDescription"), value("unit"), value("budgetedUnitCost"), value("costCategory"), value("unitPrice")]).toEqual(["Scissor lift", "day", "450.00", "EQUIPMENT", ""]);
    (form.elements.namedItem("budgetedUnitCost") as HTMLInputElement).value = "500";
    expect(value("budgetedUnitCost")).toBe("500");
  });

  it("leaves a description somebody already wrote", async () => {
    (form.elements.namedItem("itemDescription") as HTMLInputElement).value = "Lift for soffit";
    await pick("a");
    expect(value("itemDescription")).toBe("Lift for soffit");
  });

  it("sends nothing of its own", () => {
    expect(new FormData(form).has("equipmentRate")).toBe(false);
    expect((form.querySelector("select[aria-label]") as HTMLSelectElement).name).toBe("");
  });
});

describe("with nothing in force on the day", () => {
  it("points to the rates page rather than an empty list", () => {
    const html = renderToStaticMarkup(createElement(EquipmentRatePicker, { rates: [{ ...lift, effectiveFrom: "2027-01-01" }], day: "2026-10-20" }));
    expect(html).toContain('href="/equipment/rates"');
    expect(html).not.toContain("<select");
  });
});
