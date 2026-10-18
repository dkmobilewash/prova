import { SLOTS } from "./statutes/slots";
import { slotsAsked } from "./statutes/forms";
import type { BuiltForm, SlotId } from "./statutes/types";

/**
 * Which blanks go on which screen of the step-by-step tool (Diego,
 * 2026-10-13: one section per screen, Next and Back).
 *
 * The groups are the sub's own way of thinking about a waiver -- who you
 * are, which job, which payment -- not the statute's paragraph order, and
 * the forms still print every value where its statute puts it. A form only
 * shows the steps it has blanks for, so Texas's conditional progress form
 * and California's unconditional final one walk different screens.
 */

export interface FieldStep {
  id: string;
  title: string;
  fields: Array<{ slot: SlotId; label: string }>;
}

export const FIELD_GROUPS: ReadonlyArray<{ id: string; title: string; slots: readonly SlotId[] }> = [
  { id: "company", title: "Your Company", slots: ["companyName", "signerTitle"] },
  {
    id: "job",
    title: "Project Details",
    slots: ["customer", "owner", "project", "jobNumber", "jobLocation", "jobDescription"],
  },
  {
    id: "payment",
    title: "Payment Details",
    slots: ["checkMaker", "payee", "amount", "throughDate", "invoiceNumber", "paymentPeriod", "disputedAmount"],
  },
  { id: "final", title: "Last Details", slots: ["priorWaiverDates", "priorUnpaidAmounts", "signedDate"] },
];

/** The screens of blanks for one form, in order, empty ones left out.
 *
 * A blank no group names is still asked, on the last screen, rather than
 * silently skipped: a slot added to the catalog later would otherwise vanish
 * from the tool and print as the statute's empty line with nothing to say
 * so. steps.test.ts fails on that case too, so it gets a proper home. */
export function fieldSteps(form: BuiltForm): FieldStep[] {
  const asked = slotsAsked(form);
  const grouped = new Set<SlotId>(FIELD_GROUPS.flatMap((group) => group.slots));
  const steps: FieldStep[] = FIELD_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    fields: group.slots.flatMap((slot) => asked.filter((field) => field.slot === slot)),
  }));
  steps[steps.length - 1].fields.push(...asked.filter((field) => !grouped.has(field.slot)));
  return steps.filter((step) => step.fields.length > 0);
}

/** Every slot a person can type into. */
export const FILLABLE_SLOTS = (Object.keys(SLOTS) as SlotId[]).filter((slot) => SLOTS[slot].fillable);
