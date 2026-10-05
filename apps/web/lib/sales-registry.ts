/**
 * WHAT A LEAD'S PUBLIC-REGISTRY COLUMNS SAY, AND WHETHER THERE IS A WAY TO RING
 * THE PLACE.
 *
 * `SalesLead` grew five columns off a §4104 subcontractor listing — a licence
 * number, a DIR registration, a city, the prime that listed them and the project
 * it was listed on. This decides what a screen SAYS about them, as plain data,
 * so the sentence a person reads is executed by a test rather than assembled in
 * JSX where nothing can check it.
 *
 * ── THE ONE THING THIS IS REALLY FOR ──
 *
 * An imported lead arrives with no telephone number. Nothing on a §4104 listing
 * carries one: the form names a company, a city, a licence and a scope of work.
 * So the question the lead page has to answer honestly is *can this lead be
 * rung, and if not, is there a key to find a number with* — and the licence
 * number is that key, because California's CSLB licence file is public and lists
 * a telephone number for very nearly every registrant.
 *
 * "Very nearly every" is measured rather than hopeful, as of 2026-10-05: 5,003 of
 * the 5,007 wall-and-ceiling firms counted across 25 counties carry a business
 * phone (99.92%). The sentences below stay qualitative on purpose — a percentage
 * on a screen is a claim that needs its sample and its date beside it, and this is
 * the place that has them.
 *
 * TWO THINGS THAT FILE DOES NOT HOLD, so that nothing here grows a sentence
 * implying it does. There is no email address in it at all ("Email addresses are
 * not provided", on all three CSLB pages), so a licence is not a route to one. And
 * there is no line type — nothing says whether a number is a desk line or a
 * mobile — so a key that finds a telephone number is not permission to dial it,
 * and no wording here may read as though it were.
 *
 * `lookupStanding` answers it in three states rather than rendering a licence
 * and leaving the reader to work out what it is for. A number on a screen under
 * the heading "Licence" is a fact nobody acts on; the same number under "this is
 * what a lookup joins on" is the next step.
 *
 * ── NO LOOKUP HAPPENS HERE, AND THE ABSENCE IS DELIBERATE ──
 *
 * Nothing in this module fetches, scrapes or imports the CSLB file, and no
 * sentence it produces claims a phone number is known. Making the join POSSIBLE
 * is this slice; doing the join is the next one. A screen that implied the number
 * had been looked up would be the "confident fact wearing a citation" failure
 * this product measures itself against.
 *
 * Pure: no prisma, no React, no dates.
 */

/** Exactly the lead columns this module reads. */
export type LeadRegistry = {
  licenceNumber: string | null;
  registrationNumber: string | null;
  city: string | null;
  listedByGc: string | null;
  listedOnProject: string | null;
  /** Not a registry column — the thing a registry lookup is FOR. */
  phone: string | null;
};

export type RegistryEntry = {
  label: string;
  value: string;
  /** Rendered in a tabular face: an identifier read out digit by digit. */
  identifier?: boolean;
};

function present(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The registry columns that are actually filled, in reading order.
 *
 * ABSENT COLUMNS ARE OMITTED, NOT RENDERED AS "unknown". Every one of these is
 * null for any lead that did not come off a listing, which is most of them — a
 * card of five "Not recorded" rows on every hand-typed lead would teach everyone
 * to skip the card, including on the leads where it is the whole point. The
 * card's own empty state says why it is empty, once.
 */
export function registryEntries(lead: LeadRegistry): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const licence = present(lead.licenceNumber);
  if (licence) entries.push({ label: "CSLB licence", value: licence, identifier: true });

  const registration = present(lead.registrationNumber);
  if (registration)
    entries.push({ label: "DIR registration", value: registration, identifier: true });

  const city = present(lead.city);
  if (city) entries.push({ label: "City", value: city });

  const gc = present(lead.listedByGc);
  if (gc) entries.push({ label: "Listed by", value: gc });

  const project = present(lead.listedOnProject);
  if (project) entries.push({ label: "Listed on", value: project });

  return entries;
}

/**
 * CAN SOMEBODY RING THIS LEAD, AND IF NOT, IS THERE A KEY TO FIND A NUMBER?
 *
 * Three states, and the middle one is the reason the licence column was added:
 *
 *  - `CALLABLE` — a number is on file. The licence stops being the way to find
 *    one and becomes the way to confirm the company is the one you think.
 *  - `LOOKUP_READY` — no number, but a licence. This is the imported lead, and
 *    the sentence names what the licence is for so the number is a next step
 *    rather than a decoration.
 *  - `NO_KEY` — neither. Said plainly, because a card that goes quiet here reads
 *    as "nothing to do" when the truth is "this one cannot be reached yet".
 *
 * No sentence here asserts that a telephone number exists for this company, and
 * none of them says a lookup has been run.
 */
export type LookupStanding = {
  kind: "CALLABLE" | "LOOKUP_READY" | "NO_KEY";
  sentence: string;
};

export function lookupStanding(lead: LeadRegistry): LookupStanding {
  const licence = present(lead.licenceNumber);
  const phone = present(lead.phone);

  if (phone) {
    return {
      kind: "CALLABLE",
      sentence: licence
        ? `A phone number is on file. Licence ${licence} is what confirms this is the same company on the public register.`
        : "A phone number is on file.",
    };
  }

  if (licence) {
    return {
      kind: "LOOKUP_READY",
      sentence: `No phone number on file. Licence ${licence} is the key a CSLB lookup joins on — the public licence file lists a telephone number for very nearly every California registrant.`,
    };
  }

  return {
    kind: "NO_KEY",
    sentence:
      "No phone number and no licence number, so there is nothing here to look a number up with. A §4104 listing prints the licence; this lead did not come from one, or that column was blank.",
  };
}

/**
 * One line for a list row: the registry facts, shortest first, or null when the
 * lead has none.
 *
 * Null rather than a placeholder, so the list of leads does not grow a line of
 * nothing on every hand-typed row. `Lic.` is abbreviated here and spelled out on
 * the lead page — a list row is scanned, not read.
 */
export function registrySummaryLine(lead: LeadRegistry): string | null {
  const parts: string[] = [];
  const licence = present(lead.licenceNumber);
  if (licence) parts.push(`Lic. ${licence}`);
  const city = present(lead.city);
  if (city) parts.push(city);
  const gc = present(lead.listedByGc);
  if (gc) parts.push(`listed by ${gc}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
