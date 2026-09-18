import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /settings/import — the page half of the owner-only guard, and the scope of
 * what it hands the preview.
 *
 * The confirm actions are tested in lib/actions/spreadsheetImport.test.ts,
 * and that file could not see either thing checked here: a page that stopped
 * refusing a non-owner, or a page that read another company's clients, jobs
 * or crew into the props it sends to the browser. The second is a leak even
 * though nothing is written — those names end up in the page's payload.
 *
 * The fake database holds TWO companies and honours `where` by equality, so
 * a lookup that forgets `companyId` returns company B's rows and this fails.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  role: "OWNER",
  queried: [] as string[],
  props: [] as Record<string, unknown>[],
  coiProps: [] as Record<string, unknown>[],
}));

const TABLES: Record<string, Row[]> = {
  contact: [
    { companyId: "co_A", name: "Acme Builders", accountType: "GENERAL_CONTRACTOR" },
    { companyId: "co_A", name: "Ready Rentals", accountType: "VENDOR" },
    { companyId: "co_B", name: "Zenith GC", accountType: "GENERAL_CONTRACTOR" },
    { companyId: "co_B", name: "Rival Rentals", accountType: "VENDOR" },
  ],
  vendor: [
    { companyId: "co_A", name: "Acme Scaffold" },
    { companyId: "co_B", name: "Harbor Supply" },
  ],
  complianceDocument: [
    { companyId: "co_A", type: "CERTIFICATE_OF_INSURANCE", partyName: "Acme Scaffold", coverageType: "General liability", expiresAt: new Date("2027-01-01T00:00:00.000Z") },
    // Same company, not a COI: the import compares certificates only.
    { companyId: "co_A", type: "LIEN_WAIVER", partyName: "Lien Waiver Party", coverageType: null, expiresAt: null },
    { companyId: "co_B", type: "CERTIFICATE_OF_INSURANCE", partyName: "Their Insured Sub", coverageType: "Auto", expiresAt: new Date("2027-02-01T00:00:00.000Z") },
  ],
  job: [
    { companyId: "co_A", name: "Tower", contact: { name: "Acme Builders" } },
    { companyId: "co_B", name: "Harbor", contact: { name: "Zenith GC" } },
  ],
  crewMember: [
    { companyId: "co_A", legalFirstName: "Maria", legalMiddleName: null, legalLastName: "Lopez", employeeNumber: null },
    { companyId: "co_B", legalFirstName: "John", legalMiddleName: null, legalLastName: "Smith", employeeNumber: "E-1" },
  ],
};

function fakeModel(name: string) {
  return {
    findMany: async ({ where = {} }: { where?: Row } = {}) => {
      state.queried.push(name);
      return TABLES[name].filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
    },
  };
}

vi.mock("@prova/db", () => ({
  prisma: {
    contact: fakeModel("contact"),
    job: fakeModel("job"),
    crewMember: fakeModel("crewMember"),
    vendor: fakeModel("vendor"),
    complianceDocument: fakeModel("complianceDocument"),
  },
  Prisma: {},
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({
    id: "user_1",
    role: state.role,
    jobFunction: null,
    company: { id: "co_A", name: "A Drywall" },
  }),
}));
vi.mock("@/components/SpreadsheetImport", () => ({
  SpreadsheetImport: (props: Record<string, unknown>) => {
    state.props.push(props);
    return null;
  },
}));

vi.mock("@/components/MyCoiImport", () => ({
  MyCoiImport: (props: Record<string, unknown>) => {
    state.coiProps.push(props);
    return null;
  },
}));

const { default: ImportPage } = await import("./page");

async function render() {
  return renderToStaticMarkup(await ImportPage());
}

beforeEach(() => {
  state.role = "OWNER";
  state.queried = [];
  state.props = [];
  state.coiProps = [];
});

describe("/settings/import", () => {
  it("refuses anyone who is not the owner, before reading anything", async () => {
    for (const role of ["MEMBER", "ADMIN", "FIELD"]) {
      state.role = role;
      const html = await render();
      expect(html).toContain("Only the account owner can import records");
    }
    expect(state.queried).toEqual([]);
    expect(state.props).toEqual([]);
    expect(state.coiProps).toEqual([]);
  });

  it("gives the owner all three imports, fed only this company's records", async () => {
    await render();
    expect(state.props.map((p) => p.kind)).toEqual(["clients", "jobs", "crew"]);
    const payload = JSON.stringify(state.props);
    expect(payload).toContain("Acme Builders");
    expect(payload).toContain("Tower");
    expect(payload).toContain("Maria");
    for (const theirs of ["Zenith GC", "Harbor", "John", "Smith", "E-1"]) {
      expect(payload).not.toContain(theirs);
    }
  });

  it("feeds the myCOI import only this company's certificates and parties", async () => {
    await render();
    expect(state.coiProps).toHaveLength(1);
    const props = state.coiProps[0] as {
      existing: { partyName: string; coverageType: string | null; expiresOn: string | null }[];
      known: { vendors: string[]; subsAndSuppliers: string[] };
    };
    // Anti-vacuity: our own rows ARE there, so "theirs is absent" means
    // something rather than describing an empty list.
    expect(props.existing).toEqual([
      { partyName: "Acme Scaffold", coverageType: "General liability", expiresOn: "2027-01-01" },
    ]);
    expect(props.known).toEqual({ vendors: ["Acme Scaffold"], subsAndSuppliers: ["Ready Rentals"] });
    const payload = JSON.stringify(state.coiProps);
    for (const theirs of ["Their Insured Sub", "Harbor Supply", "Rival Rentals", "Zenith GC", "Lien Waiver Party"]) {
      expect(payload).not.toContain(theirs);
    }
  });
});
