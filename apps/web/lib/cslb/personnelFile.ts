/**
 * THE CSLB PERSONNEL FILE, READ FOR ONE THING: WHO TO ASK FOR BY NAME.
 *
 * The master file names the business; this one names the people behind the
 * licence — owner, officers, the responsible managing officer or employee —
 * and it is published the same way (one plain GET, `fName=PersonnelData`,
 * 85.8 MB, 405,865 rows, measured 2026-10-07). A caller who asks for the
 * owner by first name gets a different conversation from one who asks for
 * "whoever handles payroll", and 96% of the licences the call list holds
 * have a named principal here.
 *
 * ── THE SHAPE, MEASURED ──
 *
 * One row is one PERSON on one licence (`SEQ-NO`). The columns that describe
 * their associations are PIPE-DELIMITED LISTS that align by position:
 * `EMP-Titl-CDE` ("Officer| Responsible Managing Officer"), `ASSN-DT` and
 * `DIS-ASSN-DT`. A person whose every association carries a disassociation
 * date has LEFT the firm, and is the person this module must not hand to a
 * caller — "ask for Bob" when Bob left in 2011 is the exact trust-killing
 * mistake the playbook warns about. So a principal is current only if at
 * least one association has no disassociation date.
 *
 * `Name` is fixed-width and padded, `LAST FIRST MIDDLE` with runs of spaces
 * between the parts; collapsing whitespace is the whole parse. Sole-owner
 * licences often have no personnel row at all — their business name IS the
 * owner's name, and the call list falls back to that.
 *
 * `Name-TP` is `Principal` for people (386,068 rows), `Business` for a
 * corporate parent (2,247), `Principal| AKA` for an alias row (17,413); only
 * the first is a person to ask for.
 *
 * Per the fixture rule, no row of the real file appears in this repo.
 */

import { licenceNumberFrom } from "@/lib/sales-licence";
import { CslbHeaderError, splitCsvLine, titleCase } from "./masterFile";

export const PERSONNEL_FILE_URL =
  "https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=PersonnelData&type=C";

const COLUMNS = {
  licence: "LIC-NO",
  nameType: "Name-TP",
  name: "Name",
  titles: "EMP-Titl-CDE",
  disassociated: "DIS-ASSN-DT",
} as const;

export type CslbPrincipal = {
  licence: string;
  /** `First Last`, title-cased, middle name dropped — what a caller says. */
  name: string;
  /** The person's titles on this licence, trimmed, in file order. */
  titles: string[];
  /** True if at least one association has no disassociation date. */
  current: boolean;
};

function headerIndexes(headerLine: string): Record<keyof typeof COLUMNS, number> {
  const names = splitCsvLine(headerLine).map((name) => name.trim().toLowerCase());
  const found = {} as Record<keyof typeof COLUMNS, number>;
  const missing: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const index = names.indexOf(column.toLowerCase());
    if (index === -1) missing.push(column);
    found[key] = index;
  }
  if (missing.length > 0) {
    throw new CslbHeaderError(
      `The CSLB personnel file no longer has the column${missing.length === 1 ? "" : "s"} ${missing.join(", ")} — its header is: ${names.join(", ")}`,
    );
  }
  return found;
}

async function* lines(chunks: AsyncIterable<string> | Iterable<string>): AsyncGenerator<string> {
  let carry = "";
  for await (const chunk of chunks) {
    carry += chunk;
    let start = 0;
    for (;;) {
      const nl = carry.indexOf("\n", start);
      if (nl === -1) break;
      const candidate = carry.slice(0, nl);
      if ((candidate.match(/"/g) ?? []).length % 2 === 1) {
        start = nl + 1;
        continue;
      }
      yield candidate.replace(/\r$/, "");
      carry = carry.slice(nl + 1);
      start = 0;
    }
  }
  if (carry.trim() !== "") yield carry.replace(/\r$/, "");
}

const pipes = (cell: string) => cell.split("|").map((part) => part.trim());

/** `SMITH     JOHN      ROBERT` → `John Smith`. */
export function personName(raw: string): string {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return titleCase(parts[0]!);
  return `${titleCase(parts[1]!)} ${titleCase(parts[0]!)}`;
}

/** Every current or former PERSON row, with its licence as a join key. */
export async function* cslbPrincipals(
  chunks: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<CslbPrincipal> {
  let at: ReturnType<typeof headerIndexes> | null = null;
  for await (const line of lines(chunks)) {
    if (at === null) {
      at = headerIndexes(line);
      continue;
    }
    const fields = splitCsvLine(line);
    if ((fields[at.nameType] ?? "").trim() !== "Principal") continue;
    const licence = licenceNumberFrom(fields[at.licence]);
    if (licence === null) continue;
    const name = personName(fields[at.name] ?? "");
    if (!name) continue;
    const titles = pipes(fields[at.titles] ?? "").filter(Boolean);
    const gone = pipes(fields[at.disassociated] ?? "");
    /* Aligned by position with the titles. An association with no
       disassociation date is live; a row with no title list at all is read
       as one association, live unless a date says otherwise. */
    const slots = Math.max(titles.length, 1);
    const current = Array.from({ length: slots }, (_, i) => gone[i] ?? "").some((d) => d === "");
    yield { licence, name, titles, current };
  }
  if (at === null) throw new CslbHeaderError("The CSLB personnel file was empty");
}

/** Who to ask for: the responsible managing officer/employee if there is one, else an officer, else the first current principal. */
export function preferredPrincipal(people: readonly CslbPrincipal[]): CslbPrincipal | null {
  const current = people.filter((p) => p.current);
  if (current.length === 0) return null;
  const rank = (p: CslbPrincipal) =>
    p.titles.some((t) => /responsible managing/i.test(t)) ? 0 : p.titles.some((t) => /officer/i.test(t)) ? 1 : 2;
  return [...current].sort((a, b) => rank(a) - rank(b))[0]!;
}

/** The preferred principal per wanted licence, plus how many rows were read. */
export async function principalsForLicences(
  chunks: AsyncIterable<string> | Iterable<string>,
  wanted: ReadonlySet<string>,
): Promise<{ owners: Map<string, CslbPrincipal>; rowsRead: number }> {
  const byLicence = new Map<string, CslbPrincipal[]>();
  let rowsRead = 0;
  for await (const person of cslbPrincipals(chunks)) {
    rowsRead++;
    if (!wanted.has(person.licence)) continue;
    const list = byLicence.get(person.licence) ?? [];
    list.push(person);
    byLicence.set(person.licence, list);
  }
  const owners = new Map<string, CslbPrincipal>();
  for (const [licence, people] of byLicence) {
    const pick = preferredPrincipal(people);
    if (pick) owners.set(licence, pick);
  }
  return { owners, rowsRead };
}
