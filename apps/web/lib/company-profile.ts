/**
 * The company's own record — the fields that print on documents somebody
 * outside this company reads.
 *
 * WHY THIS FILE EXISTS AT ALL. `Company` has had `dbaName`, `ein`,
 * `hqAddress*`, `phone` and `website` since the profile migration, and
 * until now NOTHING WROTE ANY OF THEM — `prisma.company.update` appeared
 * nowhere in `apps/web`. `name` itself was only ever written once, by
 * `requireCompanyContext` on first sign-in, as `${name}'s Company` (or
 * "My Company" when Clerk had no name to use). That generated string is
 * what prints as the contractor on the WH-347 certified payroll form, as
 * the employer on a union trust-fund remittance sheet, and above the
 * signature block a GC signs. There was no way to change it.
 *
 * Everything here is PURE, for the reason `lib/wh347.ts` gives about
 * itself: what a government agency or a trust fund reads has to be
 * executable in the unit suite, not only reachable through a form.
 *
 * The gap list below deliberately reads the SAME rule the documents read —
 * `employerAddressLines` from lib/fringe-remittance-filing.ts — rather
 * than restating "what counts as a complete address". A second copy of
 * that rule is how a form comes to say "complete" about a record the
 * remittance sheet still prints a red refusal for.
 */

import { employerAddressLines, type RemittanceFilingCompany } from "@/lib/fringe-remittance-filing";

/** The editable shape of the company record. Structural rather than the
 * Prisma row, so the rules are testable without a database — same reason
 * `RemittanceFilingCompany` is structural. */
export interface CompanyProfile {
  name: string;
  dbaName: string | null;
  ein: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
  phone: string | null;
  website: string | null;
}

/** A normalised value, or the sentence to show the person instead. Never a
 * throw: production redacts a thrown Server Action message to a digest, so
 * these have to travel as data all the way to the form. */
export type Normalized = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * EIN, STORED IN ONE FORM: nine digits hyphenated after the second —
 * `12-3456789`.
 *
 * Both forms are ACCEPTED. People copy it off an IRS letter (hyphenated),
 * out of a payroll system (nine bare digits), and occasionally with spaces
 * in it. Refusing any of those teaches nothing; storing any of them means
 * the remittance sheet and the WH-347 print whatever shape the typist
 * happened to use that day, and two prints of the same month differ.
 *
 * Hyphenated is the stored form because it is the form the IRS prints, the
 * form a fund's delinquency notice quotes back, and the form that cannot be
 * mistaken for a nine-digit SSN at a glance. Normalising on the way IN
 * rather than at each render means there is exactly one place this decision
 * lives, and nothing downstream has to know about it.
 */
export function normalizeEin(raw: string): Normalized {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };

  // Digits, hyphens and spaces only. A letter here is not a typo in an EIN,
  // it is a different number entirely (someone pasting a licence or a state
  // account id), and silently stripping it would store nine digits that are
  // not this employer's.
  if (!/^[\d\s-]+$/.test(trimmed)) {
    return {
      ok: false,
      error:
        "An EIN is digits only, usually written 12-3456789. Letters and other punctuation are not part of one — check you have not pasted a licence or state account number.",
    };
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 9) {
    return {
      ok: false,
      error: `An EIN has nine digits and this has ${digits.length}. It is the federal number the IRS issued you, written 12-3456789 — a fund keys your account to it and a delinquency notice quotes it back at you.`,
    };
  }

  return { ok: true, value: `${digits.slice(0, 2)}-${digits.slice(2)}` };
}

/**
 * Website, stored as an absolute http(s) URL.
 *
 * A bare host ("acmedrywall.com") is what people type, and it is accepted:
 * the scheme is added rather than demanded, because a refusal over a
 * missing "https://" is a refusal over nothing. Anything that still will
 * not parse as an http(s) address with a real host is refused — a stored
 * value that is not a URL is a link that goes nowhere the first time
 * somebody clicks it.
 */
export function normalizeWebsite(raw: string): Normalized {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };

  const refusal = {
    ok: false as const,
    error:
      "That is not a web address. Something like acmedrywall.com or https://acmedrywall.com — one host, no spaces.",
  };

  if (/\s/.test(trimmed)) return refusal;

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return refusal;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: "A website has to be an http:// or https:// address.",
    };
  }
  // A host with no dot is a machine name on somebody's own network, not a
  // company's website — and `new URL("https://acmedrywall")` parses happily.
  if (!url.hostname.includes(".") || url.hostname.startsWith(".") || url.hostname.endsWith(".")) {
    return refusal;
  }

  // `URL.toString()` appends a slash to a bare host. Dropped so the stored
  // value reads back as what was typed.
  const path = url.pathname === "/" ? "" : url.pathname;
  return { ok: true, value: `${url.protocol}//${url.host}${path}${url.search}${url.hash}` };
}

/**
 * Does this name look like the one sign-up invented, rather than one a
 * person entered?
 *
 * `requireCompanyContext` names a brand new company `${name}'s Company`, or
 * "My Company" when Clerk hands it no name. Both then print as the
 * contractor on a federal form. This is a NOTE, never a refusal: a real
 * company could genuinely be called "Bob's Company", and the note is still
 * worth showing them — "check this is the legal name on your contracts" is
 * good advice either way.
 */
export function looksAutoGenerated(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "My Company" || /'s Company$/.test(trimmed);
}

/** A field a document needs and the record has not got, with what the
 * document does about it. Sentences rather than labels, the same call
 * REMITTANCE_BLOCKING_FIELD_REASON makes: a label says what is absent, a
 * sentence says what happens if you send it anyway. */
export interface CompanyProfileGap {
  /** Matches the form field's `name`, so the form can put the sentence
   * beside the input that fixes it. */
  field: "name" | "ein" | "address";
  label: string;
  consequence: string;
}

/**
 * What is missing from the company record that a document somebody else
 * reads will print a hole for.
 *
 * Deliberately NOT every empty field. `phone` and `website` are on the
 * record and print on nothing today, so listing them as gaps would train
 * the reader to ignore the list — which is the only thing a gap list has
 * to avoid. Exactly the fields whose absence is already visible to a GC or
 * a trust fund are here.
 */
export function companyProfileGaps(company: CompanyProfile): CompanyProfileGap[] {
  const gaps: CompanyProfileGap[] = [];

  if (looksAutoGenerated(company.name)) {
    gaps.push({
      field: "name",
      label: "Legal company name looks auto-generated",
      consequence: `“${company.name.trim()}” is the name sign-up invented from your own name. It prints as the contractor on the WH-347 certified payroll form, as the employer on a union remittance report, and above the signature block a GC signs. Replace it with the legal name on your contracts.`,
    });
  }

  if (!company.ein?.trim()) {
    gaps.push({
      field: "ein",
      label: "EIN",
      consequence:
        "The union remittance sheet prints a red refusal where this goes. Most trust funds key the employer's account to it, and it is what a delinquency notice quotes back at you.",
    });
  }

  // The documents' own rule, not a second copy of it: all four of street,
  // city, state and ZIP, with line 2 genuinely optional.
  const filing: RemittanceFilingCompany = {
    name: company.name,
    dbaName: company.dbaName,
    hqAddressLine1: company.hqAddressLine1,
    hqAddressLine2: company.hqAddressLine2,
    hqCity: company.hqCity,
    hqState: company.hqState,
    hqZip: company.hqZip,
    ein: company.ein,
  };
  if (employerAddressLines(filing) === null) {
    gaps.push({
      field: "address",
      label: "HQ address",
      consequence:
        "The WH-347 leaves the contractor address blank and the remittance sheet prints a refusal in its place — a fund matches a report to an employer by name AND address. All four of street, city, state and ZIP are needed; a partial address counts as none.",
    });
  }

  return gaps;
}
