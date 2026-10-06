import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { prisma } from "@prova/db";
import { describe as describeConnection } from "../../../../packages/db/scripts/connection-target.mjs";
import {
  companyTargetRequest,
  resolveCompanyTarget,
} from "../../../../packages/db/scripts/company-target.mjs";
import { createCsvReader, rowsByHeader } from "./csv";
import { cslbRecordFrom, type CslbRecord } from "./masterFile";
import {
  applyPhoneFill,
  fillPlan,
  indexByLicence,
  writesFrom,
  type FillOutcome,
  type LeadForFill,
} from "./phoneFill";

/**
 * PUT A TELEPHONE NUMBER ON EVERY LEAD THAT HAS A LICENCE AND NO WAY TO BE RUNG.
 *
 *     CSLB_MASTER_FILE=~/Downloads/MasterLicenseData.csv \
 *     DATABASE_URL=... DIRECT_URL=... \
 *     pnpm --filter @prova/web run cslb:phone-fill
 *
 * It CHANGES NOTHING until you add `CSLB_APPLY=1`. The first run is a report: how
 * many leads could be filled, how many already have a number, how many carry no
 * licence, how many are not in the file. Read it, then run it again to apply.
 *
 * That default is the `clean-scratch-data.mjs` shape and it is not politeness.
 * This writes to a column a person types into, across every lead at once, and the
 * only honest way to offer that is to show the work first.
 *
 * ── GETTING THE FILE IS A HUMAN STEP, AND THAT IS FINE ──
 *
 * One plain GET of
 * `cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C`
 * returns it: 77,643,341 bytes of CSV, 243,786 rows, no registration and no fee.
 * Nothing here downloads it. A task that fetched 77MB every run would be rude to a
 * state agency and would fail differently every time their WAF had an opinion; a
 * file on disk is reproducible and can be re-read all day. The file changes slowly
 * — it is a licence register, not a feed.
 *
 * ── WHY IT DOES NOT HOLD THE FILE IN MEMORY ──
 *
 * It streams, and it keeps a record ONLY if that licence belongs to a lead that
 * needs one. The leads are read first for exactly that reason: peak memory is the
 * size of your lead list, not of California's contractor register. A run against
 * 400 leads holds 400 records regardless of whether the file has 243,786 rows or
 * ten times that.
 *
 * ── WHAT IT WILL NOT DO ──
 *
 * It will not overwrite a number somebody typed — see `phoneFill.ts`, where that
 * is the one rule, and `phoneFill.dbtest.ts`, where Postgres is made to refuse it
 * even against a stale plan. It will not invent a number that is not ten digits. It
 * will not skip a firm whose licence is suspended, because a lapsed bond is a
 * reason to ring somebody rather than to hide them.
 *
 * ── IT IS SCOPED TO ONE COMPANY, AND IT REFUSES RATHER THAN GUESSING ──
 *
 * `SalesLead` is per-company, so a job that read every lead on the database would
 * write across tenants — which is what the first draft of this file did. It now
 * resolves exactly one company through `resolveCompanyTarget`, the same tested
 * resolver `seed-demo.mjs` uses: `CSLB_COMPANY_ID`, or `CSLB_COMPANY_NAME` because
 * a name is a value the operator can actually see on screen, or the oldest company
 * when there is only one. Two companies of the same name make it STOP rather than
 * pick one.
 *
 * It is NOT a test, despite being run by vitest — see `vitest.task.config.mts` for
 * the four other mechanisms tried first and why each was worse. Nothing in CI runs
 * it: the unit config matches `*.test.ts` and the db config `*.dbtest.ts`.
 */

const FILE = process.env.CSLB_MASTER_FILE;
const COMPANY = {
  SEED_COMPANY_ID: process.env.CSLB_COMPANY_ID,
  SEED_COMPANY_NAME: process.env.CSLB_COMPANY_NAME,
};
const APPLY = process.env.CSLB_APPLY === "1";
/** Lead rows are read in pages so a large CRM does not arrive in one query. */
const PAGE = 1_000;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

async function readLeads(companyId: string): Promise<LeadForFill[]> {
  const out: LeadForFill[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.salesLead.findMany({
      where: { companyId },
      select: { id: true, companyName: true, licenceNumber: true, phone: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    out.push(...page);
    if (page.length < PAGE) return out;
    cursor = page[page.length - 1]!.id;
  }
}

/**
 * Stream the file, keeping only the licences asked for.
 *
 * The header row arrives in the first chunk and is needed to key every row after
 * it, so it is held separately rather than re-derived.
 */
async function readWanted(
  path: string,
  wanted: ReadonlySet<string>,
): Promise<{ records: CslbRecord[]; rows: number; noKey: number }> {
  const reader = createCsvReader();
  const records: CslbRecord[] = [];
  let header: string[] | null = null;
  let rows = 0;
  let noKey = 0;

  const take = (cells: string[][]): void => {
    for (const row of cells) {
      if (header === null) {
        header = row;
        continue;
      }
      rows += 1;
      const { record, refusal } = cslbRecordFrom(rowsByHeader([header, row])[0]!);
      if (refusal) {
        noKey += 1;
        continue;
      }
      if (wanted.has(record.licence)) records.push(record);
    }
  };

  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 });
  for await (const chunk of stream) take(reader.push(chunk as string));
  take(reader.end());

  return { records, rows, noKey };
}

function show(kind: FillOutcome["kind"], count: number, note: string): void {
  console.log(`  ${String(count).padStart(7)}  ${kind.padEnd(18)} ${note}`);
}

it("fills telephone numbers from the CSLB master file", async () => {
  const target = describeConnection(process.env.DATABASE_URL);
  if (!target) {
    throw new Error("cslb: DATABASE_URL is missing or unreadable. Nothing done.");
  }
  if (!FILE) {
    throw new Error(
      "cslb: set CSLB_MASTER_FILE to the master CSV. Download it from\n" +
        "      cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C",
    );
  }

  console.log(`\ncslb: database      ${target.label}`);
  console.log(`cslb: file          ${FILE}`);
  console.log(`cslb: mode          ${APPLY ? "APPLY" : "report only (set CSLB_APPLY=1 to write)"}`);

  const bytes = (await stat(FILE)).size;
  console.log(`cslb: file size     ${bytes.toLocaleString("en-US")} bytes`);

  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const resolved = resolveCompanyTarget(companyTargetRequest(COMPANY), companies);
  if (resolved.error) throw new Error(["cslb: ", ...resolved.error].join("\n"));
  for (const line of resolved.lines) console.log(`cslb: ${line}`);
  console.log(`cslb: company       ${resolved.company.name}\n`);

  const leads = await readLeads(resolved.company.id);
  /* Only the licences of leads that could actually be filled are worth carrying
     through the stream — a lead with a number already does not need a record. */
  const wanted = new Set(
    leads
      .filter((lead) => (lead.phone ?? "").trim() === "")
      .map((lead) => lead.licenceNumber)
      .filter((value): value is string => value !== null && value.trim() !== ""),
  );
  console.log(`cslb: leads         ${plural(leads.length, "lead")}`);
  console.log(`cslb: looking up    ${plural(wanted.size, "licence")}\n`);

  const { records, rows, noKey } = await readWanted(FILE, wanted);
  console.log(`cslb: file rows     ${rows.toLocaleString("en-US")}`);
  console.log(`cslb: unreadable    ${noKey.toLocaleString("en-US")} (no licence key)`);
  console.log(`cslb: matched       ${plural(records.length, "row")}\n`);

  /* A control, not a formality: a run whose stream produced NO rows would report a
     tidy "nothing to fill" and look like a clean result. A master file that parsed
     to zero rows is a broken run. */
  expect(rows).toBeGreaterThan(0);

  const { byLicence, duplicates } = indexByLicence(records);
  if (duplicates > 0) {
    console.log(`cslb: WARNING       ${plural(duplicates, "duplicate licence")} in the file\n`);
  }

  const { decisions, summary } = fillPlan(leads, (licence) => byLicence.get(licence));
  console.log("cslb: what this run would do" + (APPLY ? " — and is about to" : ""));
  show("FILLED", summary.FILLED, "a number was found and the lead had none");
  show("ALREADY_HAS_PHONE", summary.ALREADY_HAS_PHONE, "left alone, never overwritten");
  show("NO_LICENCE", summary.NO_LICENCE, "the listing carried no licence number");
  show("NOT_IN_FILE", summary.NOT_IN_FILE, "expired-non-renewable, revoked, or not California");
  show("NO_PHONE_IN_FILE", summary.NO_PHONE_IN_FILE, "in the file, no telephone column");

  /* Every lead got exactly one verdict. CLAUDE.md's rule: count what came back and
     require it to equal what was asked, before reading any of it. */
  const counted = Object.values(summary).reduce((a, b) => a + b, 0);
  expect(counted).toBe(leads.length);
  expect(decisions).toHaveLength(leads.length);

  const writes = writesFrom(decisions);
  expect(writes).toHaveLength(summary.FILLED);

  if (!APPLY) {
    console.log(`\ncslb: nothing written. Re-run with CSLB_APPLY=1 to apply.\n`);
    /* Prove it rather than saying it: re-read the exact rows this run would have
       written and require every one of them to be untouched. Asserted against the
       rows themselves, not against a count — a count can come out right while the
       wrong row changed. */
    if (writes.length > 0) {
      const after = await prisma.salesLead.findMany({
        where: { id: { in: writes.map((write) => write.id) } },
        select: { id: true, phone: true },
      });
      expect(after).toHaveLength(writes.length);
      expect(after.filter((row) => (row.phone ?? "").trim() !== "")).toEqual([]);
    }
    return;
  }

  const applied = await applyPhoneFill(prisma, writes);
  console.log(`\ncslb: written       ${plural(applied.written, "lead")}`);
  if (applied.raced.length > 0) {
    console.log(
      `cslb: raced         ${plural(applied.raced.length, "lead")} gained a number mid-run and were left alone`,
    );
  }
  console.log("");
  expect(applied.written + applied.raced.length).toBe(writes.length);
}, 600_000);
