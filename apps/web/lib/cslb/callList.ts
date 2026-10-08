import { unstable_cache } from "next/cache";
import { MASTER_FILE_URL, cslbRows, textChunks, type CslbRow } from "./masterFile";
import { PERSONNEL_FILE_URL, principalsForLicences } from "./personnelFile";
import { isCommonSpanishSurname } from "./spanishSurnames";

/**
 * THE CALL LIST: every California firm in our trades that is in good standing
 * and has a phone, with the person to ask for — built from the two CSLB files
 * and cached for a day.
 *
 * ── WHY IT IS NOT 7,000 `SalesLead` ROWS ──
 *
 * The obvious build is an import that creates a lead per firm. It would put
 * seven thousand rows on /sales, a page that renders every lead and derives a
 * band for each on every read, and it would make "a lead" mean "a row in a
 * government file" rather than "a company somebody decided to work". So the
 * list lives here, derived, and a lead is created one at a time by the
 * person dialing — `addCslbLead` — at the moment they decide to.
 *
 * ── WHY IT IS CACHED, AND WHAT THAT COSTS ──
 *
 * Both files together are ~163 MB and take ~25 s to stream and join. That is
 * inside a 60 s function but not inside a page load anyone would wait for
 * twice, so the joined result (about 7,000 small rows, well under the data
 * cache's 2 MB entry limit) is kept for 24 h. The first load of a day pays;
 * the rest do not. There is no refresh button on purpose: the file changes
 * monthly and a stale day costs nothing, while a button that re-streams
 * 163 MB on a click is a denial-of-service against ourselves.
 *
 * The classes are the four the channel exists for. `B` general building is
 * excluded on purpose: a GC is not the customer.
 */

export const CALL_LIST_CLASSES = ["C9", "C35", "C2", "C5"] as const;
export type CallListClass = (typeof CALL_LIST_CLASSES)[number];

export const CALL_LIST_CLASS_LABEL: Record<CallListClass, string> = {
  C9: "Drywall",
  C35: "Lathing & plastering",
  C2: "Insulation & acoustical",
  C5: "Framing & rough carpentry",
};

export type CallListRow = {
  licence: string;
  name: string;
  phone: string;
  city: string | null;
  county: string | null;
  classes: CallListClass[];
  /** Who to ask for, from the personnel file; null when the file names nobody current. */
  owner: string | null;
  ownerTitle: string | null;
};

export type CallList = {
  rows: CallListRow[];
  /** Aggregates for the page header, computed once with the rows. */
  totals: {
    firms: number;
    byClass: Record<CallListClass, number>;
    withOwner: number;
    spanishSurnames: number;
    counties: string[];
  };
  masterRowsRead: number;
  personnelRowsRead: number;
  /** When the cache entry was built (epoch ms), for the page to say so. A
   * timestamp, not a calendar day, which is why it is a number rather than an
   * ISO string: nothing downstream may read a day out of it. */
  builtAtMs: number;
};

async function fetchChunks(url: string): Promise<AsyncGenerator<string>> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(`CSLB answered ${response.status} to ${url.split("fName=")[1] ?? url}`);
  }
  return textChunks(response.body);
}

function isCallable(row: CslbRow): row is CslbRow & { phone: string } {
  return row.status === "CLEAR" && row.phone !== null && row.classes.some((c) => (CALL_LIST_CLASSES as readonly string[]).includes(c));
}

async function buildCallList(): Promise<CallList> {
  const firms = new Map<string, CslbRow & { phone: string }>();
  let masterRowsRead = 0;
  for await (const row of cslbRows(await fetchChunks(MASTER_FILE_URL))) {
    masterRowsRead++;
    if (isCallable(row) && !firms.has(row.licence)) firms.set(row.licence, row);
  }

  const { owners, rowsRead: personnelRowsRead } = await principalsForLicences(
    await fetchChunks(PERSONNEL_FILE_URL),
    new Set(firms.keys()),
  );

  const byClass = Object.fromEntries(CALL_LIST_CLASSES.map((c) => [c, 0])) as Record<CallListClass, number>;
  const counties = new Set<string>();
  let withOwner = 0;
  let spanishSurnames = 0;
  const rows: CallListRow[] = [];
  for (const firm of firms.values()) {
    const classes = firm.classes.filter((c): c is CallListClass => (CALL_LIST_CLASSES as readonly string[]).includes(c));
    for (const c of classes) byClass[c]++;
    if (firm.county) counties.add(firm.county);
    const owner = owners.get(firm.licence) ?? null;
    if (owner) withOwner++;
    /* The surname share is taken over the named owner, else the business
       name when it is a person's (sole owners), else nothing — never over a
       company name like "Pacific Drywall Inc". */
    const surnameSource = owner?.name ?? (firm.name && !/\b(inc|llc|corp|co|company|construction|drywall|plaster|systems|contractors?)\b/i.test(firm.name) ? firm.name : null);
    if (surnameSource && isCommonSpanishSurname(surnameSource)) spanishSurnames++;
    rows.push({
      licence: firm.licence,
      name: firm.name ?? `Licence ${firm.licence}`,
      phone: firm.phone,
      city: firm.city,
      county: firm.county,
      classes,
      owner: owner?.name ?? null,
      ownerTitle: owner?.titles[0] ?? null,
    });
  }
  rows.sort((a, b) => (a.county ?? "").localeCompare(b.county ?? "") || a.name.localeCompare(b.name));

  return {
    rows,
    totals: {
      firms: rows.length,
      byClass,
      withOwner,
      spanishSurnames,
      counties: [...counties].sort(),
    },
    masterRowsRead,
    personnelRowsRead,
    builtAtMs: Date.now(),
  };
}

/** The list, from cache when there is one less than a day old. */
export const loadCallList = unstable_cache(buildCallList, ["cslb-call-list-v1"], {
  revalidate: 60 * 60 * 24,
});
