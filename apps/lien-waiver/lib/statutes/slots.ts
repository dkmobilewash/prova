import type { SlotId } from "./types";

/**
 * Every kind of blank the four states' forms have, in the words a sub would
 * use. One catalog for all states so "the GC's name" is typed once and
 * lands in Arizona's "person with whom undersigned contracted", California's
 * "Name of Customer" and Nevada's "Undersigned's Customer" alike.
 *
 * These labels are OURS, not the statute's, and they sit beside the form,
 * never on it -- the form prints the statute's own words around the value.
 */
export type SlotKind = "text" | "money" | "date";

export interface SlotSpec {
  label: string;
  help?: string;
  kind: SlotKind;
  /** False for the signature: this tool never signs anything. The line
   * prints empty, for a pen. */
  fillable: boolean;
  /** Required before a PDF can be made. Optional ones print as the
   * statute's own blank when left empty, so they can be written in by hand. */
  required: boolean;
  placeholder?: string;
}

export const SLOTS: Record<SlotId, SlotSpec> = {
  companyName: {
    label: "Your company name",
    help: "The company giving the waiver -- you.",
    kind: "text",
    fillable: true,
    required: true,
    placeholder: "Desert Drywall LLC",
  },
  customer: {
    label: "Who you contracted with",
    help: "Usually the GC. Use the exact legal name on your subcontract.",
    kind: "text",
    fillable: true,
    required: true,
    placeholder: "Acme Builders Inc.",
  },
  owner: {
    label: "Property owner",
    help: "The owner of the property, as shown on the contract or notice of commencement.",
    kind: "text",
    fillable: true,
    required: true,
  },
  project: {
    label: "Project name",
    kind: "text",
    fillable: true,
    required: true,
    placeholder: "Mesa Medical Office Building",
  },
  jobNumber: {
    label: "Job number",
    help: "Optional. Leave it blank to write it in by hand.",
    kind: "text",
    fillable: true,
    required: false,
  },
  jobLocation: {
    label: "Job address",
    kind: "text",
    fillable: true,
    required: true,
    placeholder: "1234 E Main St, Mesa, AZ",
  },
  jobDescription: {
    label: "Job description",
    help: "What the job is -- for example, the project name and address.",
    kind: "text",
    fillable: true,
    required: true,
  },
  checkMaker: {
    label: "Who is writing the check",
    help: "Whoever the payment comes from -- usually the GC.",
    kind: "text",
    fillable: true,
    required: true,
  },
  payee: {
    label: "Who the check is payable to",
    help: "Usually your company. If it is a joint check, name every payee.",
    kind: "text",
    fillable: true,
    required: true,
  },
  amount: {
    label: "Payment amount",
    help: "The amount of this payment, not the contract total.",
    kind: "money",
    fillable: true,
    required: true,
  },
  throughDate: {
    label: "Through date",
    help: "The last day of work this payment covers -- usually the end of the pay period.",
    kind: "date",
    fillable: true,
    required: true,
  },
  disputedAmount: {
    label: "Disputed claims amount",
    help: "Money you are NOT giving up: disputed extras, unapproved change orders. Anything not listed here is released.",
    kind: "money",
    fillable: true,
    required: false,
  },
  invoiceNumber: {
    label: "Invoice or pay application number",
    kind: "text",
    fillable: true,
    required: false,
  },
  paymentPeriod: {
    label: "Payment period",
    help: "The period this final payment covers.",
    kind: "text",
    fillable: true,
    required: false,
  },
  priorWaiverDates: {
    label: "Earlier conditional waivers still unpaid: date(s)",
    help: "Only if you gave a conditional waiver for an earlier payment that never arrived.",
    kind: "text",
    fillable: true,
    required: false,
  },
  priorUnpaidAmounts: {
    label: "Earlier conditional waivers still unpaid: amount(s)",
    kind: "text",
    fillable: true,
    required: false,
  },
  signedDate: {
    label: "Date signed",
    help: "Optional. Leave it blank to date it by hand when you sign.",
    kind: "date",
    fillable: true,
    required: false,
  },
  signerTitle: {
    label: "Your title",
    help: "The title of the person signing -- Owner, President, Project Manager.",
    kind: "text",
    fillable: true,
    required: false,
  },
  signature: {
    label: "Signature",
    kind: "text",
    fillable: false,
    required: false,
  },
};
