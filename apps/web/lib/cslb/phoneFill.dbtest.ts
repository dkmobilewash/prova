import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { csvRows, rowsByHeader } from "./csv";
import { cslbRecordFrom, type CslbRecord } from "./masterFile";
import { applyPhoneFill, fillPlan, indexByLicence, writesFrom } from "./phoneFill";

/**
 * THE WHOLE CHAIN, AGAINST A REAL POSTGRES: CSV TEXT IN, TELEPHONE NUMBERS ON ROWS.
 *
 * The unit tests prove each link with the next one stubbed. This proves the links
 * hold together and — the part no mock can give — that the DATABASE refuses to
 * overwrite a number somebody typed. `applyPhoneFill` relies on `updateMany`
 * matching zero rows when the `phone` in its WHERE no longer matches, which is a
 * claim about Postgres and Prisma rather than about this repo's code. A fake client
 * that returns `{ count: 0 }` because it was told to proves nothing about that.
 *
 * Every fixture is invented. The CSV below is written as the real file writes it —
 * `(999) 999 9999` with a space, `C-9| C35` with the padding hyphen, `CLEAR` for
 * good standing — so the test exercises the measured shapes rather than tidy ones.
 */

const context = { companyId: "" };

/** The master file as CSLB prints it, including a quoted name with a comma. */
const MASTER_CSV = [
  "LicenseNo,BusinessName,FullBusinessName,BUS-NAME-2,BusinessPhone,City,County,PrimaryStatus,Classifications(s)",
  '1234567,"ACME DRYWALL, INC",,,(916) 555 1234,SACRAMENTO,SACRAMENTO,CLEAR,"C-9| C35"',
  "2345678,BRIGHT LATH,,,(530) 555 0101,CHICO,BUTTE,Contr Bond Susp,C-9",
  "3456789,SILENT CEILINGS,,,,FRESNO,FRESNO,CLEAR,D50",
  "4567890,VANG CARPENTRY,,,(707) 555 7777,UKIAH,MENDOCINO,CLEAR,C-5",
  "",
].join("\r\n");

function records(): CslbRecord[] {
  return rowsByHeader(csvRows(MASTER_CSV)).flatMap((row) => {
    const { record } = cslbRecordFrom(row);
    return record ? [record] : [];
  });
}

async function lead(companyName: string) {
  return prisma.salesLead.findFirst({ where: { companyId: context.companyId, companyName } });
}

async function leadsForFill() {
  const rows = await prisma.salesLead.findMany({
    where: { companyId: context.companyId },
    select: { id: true, companyName: true, licenceNumber: true, phone: true },
    orderBy: { companyName: "asc" },
  });
  return rows;
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: "Prova Operator Co (cslb phone fill)", isProvaOperator: true },
  });
  context.companyId = company.id;
  await prisma.salesLead.createMany({
    data: [
      /* fillable: a licence in the file, no phone */
      { companyId: company.id, companyName: "ACME DRYWALL", licenceNumber: "1234567" },
      /* a suspended licence — still a firm that answers the telephone */
      { companyId: company.id, companyName: "BRIGHT LATH", licenceNumber: "2345678" },
      /* in the file, no phone column */
      { companyId: company.id, companyName: "SILENT CEILINGS", licenceNumber: "3456789" },
      /* a number a PERSON typed. Must survive untouched. */
      {
        companyId: company.id,
        companyName: "VANG CARPENTRY",
        licenceNumber: "4567890",
        phone: "(707) 555-0000 mobile, ask for Mai",
      },
      /* the listing had no licence column */
      { companyId: company.id, companyName: "NO LICENCE CO" },
      /* a licence the master file does not carry */
      { companyId: company.id, companyName: "GONE AWAY INC", licenceNumber: "9999999" },
      /* stored with a class prefix: the join must still find it */
      { companyId: company.id, companyName: "PREFIXED CO", licenceNumber: "C-9 1234567" },
    ],
  });
});

afterAll(async () => {
  await prisma.salesLead.deleteMany({ where: { companyId: context.companyId } });
  await prisma.company.deleteMany({ where: { id: context.companyId } });
});

describe("the CSLB phone fill against a real database", () => {
  it("reads the file, fills what it can, and leaves the rest alone", async () => {
    const { byLicence, duplicates } = indexByLicence(records());
    expect(duplicates).toBe(0);
    expect(byLicence.size).toBe(4);

    const { summary, decisions } = fillPlan(await leadsForFill(), (l) => byLicence.get(l));
    expect(summary).toEqual({
      FILLED: 3, // ACME, BRIGHT LATH (suspended), PREFIXED CO
      ALREADY_HAS_PHONE: 1, // VANG
      NO_LICENCE: 1, // NO LICENCE CO
      NOT_IN_FILE: 1, // GONE AWAY INC
      NO_PHONE_IN_FILE: 1, // SILENT CEILINGS
    });
    /* Every lead got exactly one verdict. */
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(7);

    const applied = await applyPhoneFill(prisma, writesFrom(decisions));
    expect(applied).toEqual({ written: 3, raced: [] });

    expect((await lead("ACME DRYWALL"))?.phone).toBe("(916) 555-1234");
    expect((await lead("BRIGHT LATH"))?.phone).toBe("(530) 555-0101");
    expect((await lead("PREFIXED CO"))?.phone).toBe("(916) 555-1234");
    expect((await lead("SILENT CEILINGS"))?.phone).toBeNull();
    expect((await lead("NO LICENCE CO"))?.phone).toBeNull();
    expect((await lead("GONE AWAY INC"))?.phone).toBeNull();
  });

  it("left the number a person typed exactly as they typed it", async () => {
    /* Including the note after it. A bulk job that 'tidied' this would destroy the
       one piece of information nobody can get back. */
    expect((await lead("VANG CARPENTRY"))?.phone).toBe("(707) 555-0000 mobile, ask for Mai");
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { byLicence } = indexByLicence(records());
    const { summary, decisions } = fillPlan(await leadsForFill(), (l) => byLicence.get(l));
    expect(summary.FILLED).toBe(0);
    expect(summary.ALREADY_HAS_PHONE).toBe(4);
    expect(await applyPhoneFill(prisma, writesFrom(decisions))).toEqual({
      written: 0,
      raced: [],
    });
  });

  it("POSTGRES refuses the write when the phone changed under it", async () => {
    /* The claim `applyPhoneFill` rests on, executed against the real database
       rather than against a client that was told to say no. A stale plan — one
       that still believes this lead has no phone — must not win. */
    const target = await prisma.salesLead.create({
      data: { companyId: context.companyId, companyName: "RACED CO", licenceNumber: "1234567" },
    });
    const { byLicence } = indexByLicence(records());
    const { decisions } = fillPlan(
      [{ id: target.id, companyName: "RACED CO", licenceNumber: "1234567", phone: null }],
      (l) => byLicence.get(l),
    );
    const stale = writesFrom(decisions);
    expect(stale).toHaveLength(1);

    /* Somebody types a number while the run is in flight. */
    await prisma.salesLead.update({
      where: { id: target.id },
      data: { phone: "typed during the run" },
    });

    expect(await applyPhoneFill(prisma, stale)).toEqual({ written: 0, raced: [target.id] });
    expect((await lead("RACED CO"))?.phone).toBe("typed during the run");
  });
});
