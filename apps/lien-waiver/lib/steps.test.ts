import { describe, expect, it } from "vitest";
import { formsFor, slotsAsked } from "./statutes/forms";
import { STATES } from "./statutes/types";
import { FIELD_GROUPS, FILLABLE_SLOTS, fieldSteps } from "./steps";

describe("the step-by-step screens", () => {
  it("every fillable blank in the catalog has exactly one screen", () => {
    const grouped = FIELD_GROUPS.flatMap((group) => group.slots);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...FILLABLE_SLOTS].sort());
  });

  // Derived from the forms themselves, and the count is asserted, so an
  // empty list of forms cannot pass everything below by having nothing in it.
  const forms = STATES.flatMap((state) => formsFor(state));
  it("walks all sixteen forms", () => expect(forms).toHaveLength(16));

  it.each(forms.map((form) => [`${form.state} ${form.form}`, form] as const))(
    "%s asks every blank it has, once, and no other",
    (_name, form) => {
      const onScreens = fieldSteps(form).flatMap((step) => step.fields.map((field) => field.slot));
      expect(new Set(onScreens).size).toBe(onScreens.length);
      expect([...onScreens].sort()).toEqual(slotsAsked(form).map((field) => field.slot).sort());
      expect(fieldSteps(form).every((step) => step.fields.length > 0)).toBe(true);
    },
  );
});
