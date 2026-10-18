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

/**
 * ── THE LINK THAT CLOSES THE GAP, AND WHY IT GOES TO A SEARCH BOX ──
 *
 * The card above tells a reader the licence "is the key a CSLB lookup joins on"
 * and then gives them no way to perform one, which leaves the last step as
 * retyping a licence into a search engine. This closes it.
 *
 * **IT LINKS THE SEARCH PAGE, NOT A LICENCE DETAIL PAGE, AND THAT IS A MEASURED
 * DECISION RATHER THAN A CAUTIOUS ONE.** CSLB's licence detail page has a URL
 * that looks exactly like a deep link —
 * `…/CheckLicenseII/LicenseDetail.aspx?LicNum=<n>` — and it is the URL a browser
 * shows you after you search, so it is the obvious thing to build. It does not
 * work. Driven in a real Chromium on 2026-10-05:
 *
 *   - the SAME licence number through the search form reaches
 *     `LicenseDetail.aspx?LicNum=<n>` and renders the detail page;
 *   - that same URL requested COLD, in a fresh browser context with no CSLB
 *     session, answers **HTTP 302 to `CheckLicense.aspx`** — the search page —
 *     and the page that arrives has innerText BYTE-IDENTICAL (sha256 prefix
 *     `145157bb836b22ae`) to simply visiting `CheckLicense.aspx`.
 *
 * Same number, two paths, different outcome: what differs is the session, not
 * the licence. A link from this app is always the cold case, so a
 * `LicenseDetail.aspx?LicNum=` href would promise a detail page and silently
 * deliver an empty search box — a false claim that degrades quietly, which is
 * the worst shape a link can have. Linking the search page lands in the same
 * place and says so.
 *
 * **AND THE DETAIL PAGE ECHOES ANY NUMBER YOU HAND IT.** Requested through the
 * form for a licence with no record, it returns 200 and renders
 * `<h1>Contractor's License Detail for License # <the number you asked for></h1>`
 * with NO business name, no status and no phone — the data panel is simply
 * absent. So "it returned 200 and showed my licence number" is not evidence the
 * licence exists, and a deep link could not have been self-validating even if it
 * had been reachable.
 *
 * What is NOT established, said plainly rather than left to be assumed: nobody
 * here has seen a POPULATED detail page. CSLB sits behind an F5 WAF that 403s
 * this container's address after a handful of requests and blocks the
 * business-name search outright, so no licence number CSLB itself vouches for
 * could be obtained to render one. That bounds the claim "the detail page shows
 * a phone number" — which is why no sentence here makes it. It does not touch
 * the conclusion above, which rests on one number behaving two ways.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CLAIM ──
 *
 * Not that a phone number will be found; the measurement is a rate, and a rate
 * is not a promise about one company. Not that an email can be found — CSLB
 * publishes none, and nothing here may grow a sentence implying otherwise. And
 * `telHref` is a link a PERSON taps, never a dialler: no line-type field exists
 * anywhere in this data, roughly a third of these registrants are sole owners,
 * and automatically dialling what might be a man's mobile is not a thing this
 * product does.
 */

/**
 * CSLB's licence-number search box. Verified to answer 200 in a real browser
 * with the licence field (`#MainContent_LicNo`) on it.
 *
 * Deliberately NOT `LicenseDetail.aspx?LicNum=…`: that 302s to this very URL for
 * anybody arriving without a CSLB session, which every visitor from this app is.
 */
export const CSLB_LICENCE_SEARCH_URL =
  "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx";

export type RegisterLookup = {
  /** Where to send them. A search page, because a deep link does not exist. */
  url: string;
  /** The number they paste into it — shown on screen, never only in the href. */
  licenceNumber: string;
  /** The link's own words. Says "look up", never "call" or "phone number". */
  linkLabel: string;
  /**
   * What happens when they get there, said BEFORE they click. A link that lands
   * on a search box when you expected a record is a link people stop trusting.
   */
  instruction: string;
};

/**
 * The lookup a lead's licence makes possible, or null when there is no licence.
 *
 * Null rather than a disabled link: there is nothing to look up with, the
 * standing sentence already says so, and a dead control is worse than no
 * control.
 */
export function registerLookup(lead: LeadRegistry): RegisterLookup | null {
  const licence = present(lead.licenceNumber);
  if (!licence) return null;
  return {
    url: CSLB_LICENCE_SEARCH_URL,
    licenceNumber: licence,
    linkLabel: "Look this licence up on CSLB",
    instruction: `Opens CSLB's licence search. Paste ${licence} into the licence-number box — CSLB has no link that opens a licence directly.`,
  };
}

/**
 * A `tel:` href for a number that is on file, or null.
 *
 * Digits and a leading `+` only, because that is all `tel:` means: a stored
 * number is whatever somebody typed, and "(909) 555-0134 ext 2" must not become
 * an href that dials the extension as part of the number. The number is rendered
 * AS TYPED beside this; only the href is stripped.
 *
 * Null when nothing survives stripping, so a phone column holding "call the
 * office" does not become a link that dials nothing.
 */
export function telHref(lead: LeadRegistry): string | null {
  const phone = present(lead.phone);
  if (!phone) return null;
  const plus = phone.trimStart().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `tel:${plus ? "+" : ""}${digits}`;
}
