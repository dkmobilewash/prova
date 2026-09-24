/**
 * The DAS 140 and DAS 142 as the forms themselves, not as reports about them.
 *
 * Pure: values in, a printable structure out. The page renders it.
 *
 * MODELLED DIRECTLY ON lib/wh347.ts, and the borrowing is deliberate rather
 * than lazy. That module solved the same problem — a government document
 * signed by a person, with boxes this app can only sometimes fill — and its
 * answer is the one worth repeating: a field the app cannot source is carried
 * as a BLOCKING entry with a human sentence, the page prints that sentence in
 * red where the value would have gone, and the form is marked not sendable.
 * "Writing TBD, N/A, unknown or leaving information blank will invalidate the
 * form" is what the secondary guidance says about a DAS 140; a form that
 * looks finished and is not is the expensive failure here, exactly as it is
 * on a WH-347.
 *
 * WHAT IT WILL NOT DO, and this is the whole of the area's value:
 *
 *   - It never invents a committee address, a program sponsor number or a
 *     contact. Those come off `ApprenticeshipCommittee`, which a person fills
 *     in from DIR's own lookup, and a blank stays blank with a sentence
 *     saying who fills it. There is a documented penalty for sending a
 *     dispatch request to the wrong committee, so a plausible-looking address
 *     is not a lesser wrong than an empty one — it is a worse one, because
 *     nobody checks a filled box.
 *   - It never prints a licence number from the wrong jurisdiction. A
 *     California public-works form wants the California licence; if the
 *     company has recorded licences and none of them is Californian, the form
 *     says so rather than printing whichever one it found first.
 *   - It never derives the contractor's estimate of journeyman and apprentice
 *     hours from the estimate's labor lines. Those are priced work split by
 *     cost code, not by tier, and converting one into the other would be this
 *     app making a projection in the contractor's name on a document the
 *     state keeps.
 *   - It prints NO reference number. See lib/das-forms.ts on why there is no
 *     counter.
 *
 * SIGNATURE IS ALWAYS BLOCKING, on both forms, and it is not a stub. Neither
 * form is a filing this app can complete: somebody signs it and somebody
 * sends it. Saying so on the sheet — where the person about to send it is
 * looking — is the honest version of a feature that gets you 90% of the way.
 */

import { formatCalendarDay } from "./render-date";
import {
  DAS142_LEAD_TIME_CAVEATS,
  type IsoDay,
  latestSendDayIgnoringHolidays,
} from "./das-forms";

/* ------------------------------------------------------------------ *
 * Blocking fields
 * ------------------------------------------------------------------ */

/**
 * A box the form has that this app cannot fill yet.
 *
 * Carried as data rather than rendered as a dash so a test can assert WHICH
 * box is missing, and so the page can refuse to present the form as sendable.
 * Same reasoning as `Wh347BlockingField`, which its own comment gives: "a
 * blank cell on a government form is indistinguishable from a zero to
 * everyone except the person who filled it in."
 */
export type DasBlockingField =
  | "contractorAddress"
  | "contractorLicense"
  | "committeeDelivery"
  | "awardingBody"
  | "projectLocation"
  | "projectIdentifier"
  | "estimatedHours"
  | "signature";

/** Human sentences, not labels — the reader has to learn what to do about it
 * rather than that something is absent. */
export const DAS_BLOCKING_REASON: Record<DasBlockingField, string> = {
  contractorAddress:
    "No address on the company record. The form identifies who was awarded the contract — an owner records it at Settings → Company.",
  contractorLicense:
    "No California contractor licence is recorded. The form wants the state licence number for the contractor doing this work; add it at Settings → Licences. A licence from another state is deliberately not printed here.",
  committeeDelivery:
    "This committee has no address, email or fax recorded, so there is nowhere to send it. Look the committee up on DIR and record how it receives notices — sending one to the wrong committee has its own penalty.",
  awardingBody:
    "The awarding body is not recorded on this job. Enter it on the job's Compliance tab, from the call for bids.",
  projectLocation:
    "The project's location is not recorded on this job. Enter the site address on the job page.",
  projectIdentifier:
    "The awarding body's project number is not recorded on this notice. Take it off the call for bids — guidance on this form says writing TBD or N/A invalidates it, so a blank is not a safe substitute.",
  estimatedHours:
    "The form asks for your own estimate of journeyman and apprentice hours on this craft. C Stream does not derive them: the estimate is priced work split by cost code, not by apprentice tier, and a projection made in your name on a state form is not ours to make.",
  signature:
    "The form is signed and dated by a person, and C Stream does not sign anything. Print it, sign it, send it, then come back and record the date and how it went.",
};

/** Printed in this order, whatever order they were found in. */
const BLOCKING_ORDER: DasBlockingField[] = [
  "contractorAddress",
  "contractorLicense",
  "committeeDelivery",
  "awardingBody",
  "projectLocation",
  "projectIdentifier",
  "estimatedHours",
  "signature",
];

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export interface DasCompanyInput {
  name: string;
  dbaName: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
  phone: string | null;
  /** Every licence the company has recorded. The builder picks — see
   * `californiaLicense`. */
  licenses: readonly { jurisdictionName: string; licenseNumber: string }[];
}

export interface DasJobInput {
  name: string;
  /** The site address, then the looser "in the person's words" location. Both
   * nullable; the form takes the first one there is. */
  siteAddress: string | null;
  projectLocation: string | null;
  awardingBody: string | null;
  siteCounty: string | null;
}

export interface DasCommitteeInput {
  name: string;
  craftName: string;
  geographicArea: string;
  programSponsorNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
  fax: string | null;
}

/* ------------------------------------------------------------------ *
 * Shared header
 * ------------------------------------------------------------------ */

export interface DasContractorBlock {
  name: string;
  /** Null when nothing is recorded — the page prints the reason, not a dash. */
  address: string | null;
  phone: string | null;
  licenseNumber: string | null;
  /** What was found when no California licence was. Named so the sentence on
   * screen can be specific instead of generic. */
  licenseFoundInstead: readonly string[];
}

export interface DasCommitteeBlock {
  name: string;
  craftName: string;
  geographicArea: string;
  address: string | null;
  email: string | null;
  fax: string | null;
  programSponsorNumber: string | null;
}

export interface DasProjectBlock {
  name: string;
  location: string | null;
  awardingBody: string | null;
  county: string | null;
  identifier: string | null;
}

function joinLines(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return kept.length > 0 ? kept.join(", ") : null;
}

/**
 * The California licence, or nothing.
 *
 * Matching on the jurisdiction NAME rather than taking the first row, and
 * reporting what it found instead when it fails. `CompanyLicense.
 * jurisdictionName` is free text ("California", "Arizona", "City of
 * Longmont, CO"), so this is a substring test on purpose; the alternative is
 * an enum this app does not have, and the failure mode of a loose match here
 * — printing a licence whose jurisdiction merely mentions California — is
 * strictly less bad than printing an Arizona number on a California form.
 */
function californiaLicense(
  licenses: readonly { jurisdictionName: string; licenseNumber: string }[],
): { licenseNumber: string | null; foundInstead: string[] } {
  const match = licenses.find((l) => /california/i.test(l.jurisdictionName) || /\bCA\b/.test(l.jurisdictionName));
  if (match) return { licenseNumber: match.licenseNumber, foundInstead: [] };
  return { licenseNumber: null, foundInstead: licenses.map((l) => l.jurisdictionName) };
}

function contractorBlock(company: DasCompanyInput): DasContractorBlock {
  const { licenseNumber, foundInstead } = californiaLicense(company.licenses);
  return {
    name: company.dbaName ? `${company.name} (dba ${company.dbaName})` : company.name,
    address: joinLines([
      company.hqAddressLine1,
      company.hqAddressLine2,
      company.hqCity,
      joinLines([company.hqState, company.hqZip])?.replace(", ", " ") ?? null,
    ]),
    phone: company.phone,
    licenseNumber,
    licenseFoundInstead: foundInstead,
  };
}

function committeeBlock(committee: DasCommitteeInput): DasCommitteeBlock {
  return {
    name: committee.name,
    craftName: committee.craftName,
    geographicArea: committee.geographicArea,
    address: joinLines([
      committee.addressLine1,
      committee.addressLine2,
      committee.city,
      joinLines([committee.state, committee.postalCode])?.replace(", ", " ") ?? null,
    ]),
    email: committee.email,
    fax: committee.fax,
    programSponsorNumber: committee.programSponsorNumber,
  };
}

function projectBlock(job: DasJobInput, identifier: string | null): DasProjectBlock {
  return {
    name: job.name,
    location: job.siteAddress ?? job.projectLocation ?? null,
    awardingBody: job.awardingBody,
    county: job.siteCounty,
    identifier,
  };
}

/** The blocking fields every DAS form shares. */
function sharedBlocking(
  contractor: DasContractorBlock,
  committee: DasCommitteeBlock,
  project: DasProjectBlock,
): DasBlockingField[] {
  const blocking: DasBlockingField[] = [];
  if (contractor.address === null) blocking.push("contractorAddress");
  if (contractor.licenseNumber === null) blocking.push("contractorLicense");
  // Any ONE of the three is enough to send it, which is why this is a single
  // field rather than three: 8 CCR 230.1 names first class mail, fax and
  // email, so a committee with an email and no street address is perfectly
  // reachable and must not be reported as incomplete.
  if (committee.address === null && committee.email === null && committee.fax === null) {
    blocking.push("committeeDelivery");
  }
  if (project.awardingBody === null) blocking.push("awardingBody");
  if (project.location === null) blocking.push("projectLocation");
  if (project.identifier === null) blocking.push("projectIdentifier");
  // Always. Nothing here signs anything.
  blocking.push("signature");
  return blocking;
}

function ordered(blocking: readonly DasBlockingField[]): DasBlockingField[] {
  const present = new Set(blocking);
  return BLOCKING_ORDER.filter((f) => present.has(f));
}

/* ------------------------------------------------------------------ *
 * DAS 140
 * ------------------------------------------------------------------ */

export type DasElection = "APPROVED_TO_TRAIN" | "WILL_COMPLY_WITH_STANDARDS" | "CAC_REGULATIONS";

/** The three boxes, in the form's own order, worded the way the secondary
 * sources word them. UNVERIFIED against the current form — see
 * `das140-three-elections` in lib/das-forms.ts. */
export const DAS140_ELECTIONS: readonly { value: DasElection; box: number; label: string }[] = [
  {
    value: "APPROVED_TO_TRAIN",
    box: 1,
    label: "We are already approved to train apprentices by this apprenticeship committee.",
  },
  {
    value: "WILL_COMPLY_WITH_STANDARDS",
    box: 2,
    label:
      "We will comply with this committee's apprenticeship standards for the duration of this project.",
  },
  {
    value: "CAC_REGULATIONS",
    box: 3,
    label:
      "We will be governed by the apprenticeship standards and regulations of the California Apprenticeship Council.",
  },
] as const;

export function das140ElectionLabel(election: DasElection): string {
  const found = DAS140_ELECTIONS.find((e) => e.value === election);
  if (!found) throw new Error(`No DAS 140 election named "${election}"`);
  return `Box ${found.box} — ${found.label}`;
}

export interface Das140Input {
  company: DasCompanyInput;
  job: DasJobInput;
  committee: DasCommitteeInput;
  notice: {
    craftName: string;
    election: DasElection;
    contractExecutedOn: IsoDay;
    estimatedJourneymanHours: number | null;
    estimatedApprenticeHours: number | null;
    estimatedStartOn: IsoDay | null;
    estimatedCompletionOn: IsoDay | null;
    contractAmount: number | null;
    projectIdentifier: string | null;
    sentOn: IsoDay | null;
  };
}

export interface Das140Form {
  contractor: DasContractorBlock;
  committee: DasCommitteeBlock;
  project: DasProjectBlock;
  craftName: string;
  election: DasElection;
  electionLabel: string;
  /** Pre-formatted for print. Every date on this form is a plain calendar
   * day, so they all go through `formatCalendarDay` and none can pick up the
   * reader's zone — #101, and lib/render-date.ts's own header. */
  contractExecutedOn: string;
  estimatedStartOn: string | null;
  estimatedCompletionOn: string | null;
  estimatedJourneymanHours: number | null;
  estimatedApprenticeHours: number | null;
  contractAmount: number | null;
  sentOn: string | null;
  blocking: DasBlockingField[];
  /** False whenever anything is blocking. The page must not present the form
   * as ready to send when this is false. */
  sendable: boolean;
}

export function buildDas140(input: Das140Input): Das140Form {
  const contractor = contractorBlock(input.company);
  const committee = committeeBlock(input.committee);
  const project = projectBlock(input.job, input.notice.projectIdentifier);

  const blocking = sharedBlocking(contractor, committee, project);
  // BOTH estimates, or the box is not answered. One of the two filled in
  // reads as a complete answer to a reviewer and is not one.
  if (
    input.notice.estimatedJourneymanHours === null ||
    input.notice.estimatedApprenticeHours === null
  ) {
    blocking.push("estimatedHours");
  }

  const final = ordered(blocking);
  return {
    contractor,
    committee,
    project,
    craftName: input.notice.craftName,
    election: input.notice.election,
    electionLabel: das140ElectionLabel(input.notice.election),
    contractExecutedOn: formatCalendarDay(input.notice.contractExecutedOn),
    estimatedStartOn:
      input.notice.estimatedStartOn === null ? null : formatCalendarDay(input.notice.estimatedStartOn),
    estimatedCompletionOn:
      input.notice.estimatedCompletionOn === null
        ? null
        : formatCalendarDay(input.notice.estimatedCompletionOn),
    estimatedJourneymanHours: input.notice.estimatedJourneymanHours,
    estimatedApprenticeHours: input.notice.estimatedApprenticeHours,
    contractAmount: input.notice.contractAmount,
    sentOn: input.notice.sentOn === null ? null : formatCalendarDay(input.notice.sentOn),
    blocking: final,
    sendable: final.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 * DAS 142
 * ------------------------------------------------------------------ */

export interface Das142Input {
  company: DasCompanyInput;
  job: DasJobInput;
  committee: DasCommitteeInput;
  request: {
    craftName: string;
    apprenticesRequested: number;
    neededFrom: IsoDay;
    neededTo: IsoDay | null;
    requestedOn: IsoDay | null;
    projectIdentifier: string | null;
  };
}

export interface Das142Form {
  contractor: DasContractorBlock;
  committee: DasCommitteeBlock;
  project: DasProjectBlock;
  craftName: string;
  apprenticesRequested: number;
  neededFrom: string;
  neededTo: string | null;
  requestedOn: string | null;
  /** The last day it could go out, as far as whole days can tell. Printed
   * with `leadTimeCaveats` beside it, always. */
  latestSendDay: string;
  leadTimeCaveats: readonly string[];
  blocking: DasBlockingField[];
  sendable: boolean;
}

export function buildDas142(input: Das142Input): Das142Form {
  const contractor = contractorBlock(input.company);
  const committee = committeeBlock(input.committee);
  const project = projectBlock(input.job, input.request.projectIdentifier);
  const final = ordered(sharedBlocking(contractor, committee, project));

  return {
    contractor,
    committee,
    project,
    craftName: input.request.craftName,
    apprenticesRequested: input.request.apprenticesRequested,
    neededFrom: formatCalendarDay(input.request.neededFrom),
    neededTo: input.request.neededTo === null ? null : formatCalendarDay(input.request.neededTo),
    requestedOn:
      input.request.requestedOn === null ? null : formatCalendarDay(input.request.requestedOn),
    latestSendDay: formatCalendarDay(latestSendDayIgnoringHolidays(input.request.neededFrom)),
    leadTimeCaveats: DAS142_LEAD_TIME_CAVEATS,
    blocking: final,
    sendable: final.length === 0,
  };
}
