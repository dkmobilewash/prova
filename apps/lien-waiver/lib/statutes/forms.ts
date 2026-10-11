import generated from "./generated/forms.json";
import { SLOTS } from "./slots";
import type { BuiltForm, FormKey, SlotId, StateCode } from "./types";

/**
 * The forms as the app uses them -- imported from the generated file, never
 * built at request time. Safe to import from client components: no Node
 * APIs, and only the four states' form paragraphs (a few kB each), not the
 * statute pages they came from.
 */
export const FORMS = generated as BuiltForm[];

export function getForm(state: StateCode, form: FormKey): BuiltForm {
  const found = FORMS.find((candidate) => candidate.state === state && candidate.form === form);
  if (!found) throw new Error(`no ${form} form for ${state}`);
  return found;
}

export function formsFor(state: StateCode): BuiltForm[] {
  return FORMS.filter((form) => form.state === state);
}

export const fillable = (slot: SlotId) => SLOTS[slot].fillable;

/** The distinct slots a form asks for, in the order it first asks. A slot
 * used twice (Arizona and Texas name the customer twice in one form) is
 * asked once and printed in both places. */
export function slotsAsked(form: BuiltForm): Array<{ slot: SlotId; label: string }> {
  const seen = new Set<SlotId>();
  const out: Array<{ slot: SlotId; label: string }> = [];
  for (const ref of form.slots) {
    if (seen.has(ref.slot) || !SLOTS[ref.slot].fillable) continue;
    seen.add(ref.slot);
    out.push({ slot: ref.slot, label: ref.label ?? SLOTS[ref.slot].label });
  }
  return out;
}
