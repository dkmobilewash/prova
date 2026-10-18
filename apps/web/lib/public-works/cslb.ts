import { csvObjects, textChunks } from "./csv";

/**
 * CSLB'S TWO FREE FILES, READ FOR THE FIRMS C STREAM SELLS TO.
 *
 * Both are one plain GET, no login and no token (measured 2026-10-05 and
 * again 2026-10-13: 200, `text/csv`, ~78 MB and ~86 MB). The master file is
 * 243,786 licences by 52 columns; this keeps the few thousand that are in
 * good standing and hold one of the wall-and-ceiling classifications, and
 * reads eleven columns of those.
 *
 * TWO TRAPS, BOTH HANDLED: "in good standing" is spelled `CLEAR`, not
 * `ACTIVE` — a filter on `ACTIVE` matches zero rows and goes green. And the
 * classification column is literally named `Classifications(s)` and prints
 * codes in BOTH spellings at once (`C9`, `C-7`), so `classCodes()` collapses
 * them before anything compares.
 *
 * No email: CSLB publishes none by statute (B&P §27). No line type either, so
 * a phone here is a number a person may click to ring, nothing more.
 */

export const MASTER_FILE_URL =
  "https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C";
export const PERSONNEL_FILE_URL =
  "https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=PersonnelData&type=C";

/** C-9 drywall, C-35 lathing and plastering, C-2 insulation and acoustical,
 * C-5 framing and rough carpentry. The product's market. */
export const TARGET_CLASSES = ["C9", "C35", "C2", "C5"] as const;

export type CslbFirm = {
  licence: string;
  name: string;
  fullName: string | null;
  phone: string | null;
  mailingAddress: string | null;
  city: string | null;
  county: string | null;
  zip: string | null;
  classes: string[];
  businessType: string | null;
  hasEmployees: boolean;
  issuedOn: Date | null;
};

export type CslbOwner = { name: string; title: string };

export function classCodes(cell: string): string[] {
  return cell
    .split("|")
    .map((c) => c.trim().toUpperCase().replace(/-/g, ""))
    .filter(Boolean);
}

export function bareLicence(s: string): string {
  return s.replace(/\D/g, "").replace(/^0+/, "");
}

/** CSLB writes dates as MM/DD/YYYY. */
export function cslbDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))) : null;
}

function blankToNull(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

/** One master-file row to a firm, or null when it is not a prospect. */
export function firmFromMasterRow(row: Record<string, string>): CslbFirm | null {
  if ((row["primarystatus"] ?? "").trim() !== "CLEAR") return null;
  const classes = classCodes(row["classifications(s)"] ?? "");
  if (!classes.some((c) => (TARGET_CLASSES as readonly string[]).includes(c))) return null;
  const licence = bareLicence(row["licenseno"] ?? "");
  if (!licence) return null;
  const wc = (row["workerscompcoveragetype"] ?? "").trim();
  return {
    licence,
    name: (row["businessname"] ?? "").trim(),
    fullName: blankToNull(row["fullbusinessname"]),
    phone: blankToNull(row["businessphone"]),
    mailingAddress: blankToNull(row["mailingaddress"]),
    city: blankToNull(row["city"]),
    county: blankToNull(row["county"]),
    zip: blankToNull(row["zipcode"]),
    classes,
    businessType: blankToNull(row["businesstype"]),
    // Only an insurance policy says "has employees". `Exempt` is the
    // one-person shop; a leasing firm or a lapsed policy is not a yes either.
    hasEmployees: wc.startsWith("Workers"),
    issuedOn: cslbDate(row["issuedate"] ?? ""),
  };
}

/** One personnel-file row to an owner line, keyed by licence. The name
 * column is padded surname-first (`DAVIS   DANA   MICHAEL`); runs of
 * whitespace collapse to one space and the order is kept as printed. */
export function ownerFromPersonnelRow(row: Record<string, string>): { licence: string; owner: CslbOwner } | null {
  const licence = bareLicence(row["lic-no"] ?? "");
  const name = (row["name"] ?? "").replace(/\s+/g, " ").trim();
  if (!licence || !name) return null;
  const title = (row["emp-titl-cde"] ?? "").split("|")[0].trim();
  return { licence, owner: { name, title } };
}

export async function fetchCsv(url: string, fetchImpl: typeof fetch = fetch): Promise<AsyncIterable<string>> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`CSLB answered ${response.status} to ${url.split("fName=")[1] ?? url}`);
  return textChunks(response.body);
}

/** Every prospect firm in the master file, streamed. */
export async function* readFirms(fetchImpl: typeof fetch = fetch): AsyncGenerator<CslbFirm> {
  for await (const row of csvObjects(await fetchCsv(MASTER_FILE_URL, fetchImpl))) {
    const firm = firmFromMasterRow(row);
    if (firm) yield firm;
  }
}

/** Owners for exactly the licences asked for, streamed from the personnel file. */
export async function readOwners(
  licences: Set<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, CslbOwner[]>> {
  const out = new Map<string, CslbOwner[]>();
  for await (const row of csvObjects(await fetchCsv(PERSONNEL_FILE_URL, fetchImpl))) {
    const parsed = ownerFromPersonnelRow(row);
    if (!parsed || !licences.has(parsed.licence)) continue;
    const list = out.get(parsed.licence) ?? [];
    if (list.length < 5) list.push(parsed.owner);
    out.set(parsed.licence, list);
  }
  return out;
}
