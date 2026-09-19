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
  jobFunction: null as string | null,
  queried: [] as string[],
  props: [] as Record<string, unknown>[],
  coiProps: [] as Record<string, unknown>[],
  registerProps: [] as Record<string, unknown>[],
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
  contactPerson: [
    { companyId: "co_A", name: "Priya Shah", contact: { name: "Acme Builders" } },
    { companyId: "co_B", name: "Wei Chen", contact: { name: "Zenith GC" } },
  ],
  crewMember: [
    { companyId: "co_A", id: "crew_maria", legalFirstName: "Maria", legalMiddleName: null, legalLastName: "Lopez", employeeNumber: null, identifyingNumberLast4: null },
    { companyId: "co_B", id: "crew_john", legalFirstName: "John", legalMiddleName: null, legalLastName: "Smith", employeeNumber: "E-1", identifyingNumberLast4: null },
  ],
  payrollRegisterEntry: [
    { companyId: "co_A", crewMemberId: "crew_maria", periodStart: new Date("2026-08-23T00:00:00.000Z"), periodEnd: new Date("2026-08-29T00:00:00.000Z"), grossCents: 100000, deductionsCents: 20000, netCents: 80000, hours: "40", payDate: null },
    { companyId: "co_B", crewMemberId: "crew_john", periodStart: new Date("2026-08-23T00:00:00.000Z"), periodEnd: new Date("2026-08-29T00:00:00.000Z"), grossCents: 200000, deductionsCents: 40000, netCents: 160000, hours: "40", payDate: null },
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
    payrollRegisterEntry: fakeModel("payrollRegisterEntry"),
    contactPerson: fakeModel("contactPerson"),
  },
  Prisma: {},
}));
vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => ({
    id: "user_1",
    role: state.role,
    jobFunction: state.jobFunction,
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

// Not mocking this pulls in the real component, which imports the whole
// "@/lib/actions" barrel — every action module in the app, including ones
// with module-level Prisma calls this test's light db mock cannot satisfy.
// Same reason SpreadsheetImport and MyCoiImport are mocked above.
vi.mock("@/components/PayrollRegisterImport", () => ({
  PayrollRegisterImport: (props: Record<string, unknown>) => {
    state.registerProps.push(props);
    return null;
  },
}));

const { default: ImportPage } = await import("./page");

async function render() {
  return renderToStaticMarkup(await ImportPage());
}

beforeEach(() => {
  state.role = "OWNER";
  state.jobFunction = null;
  state.queried = [];
  state.props = [];
  state.coiProps = [];
  state.registerProps = [];
});

describe("/settings/import", () => {
  it("refuses a non-owner who also lacks MANAGE_COMPLIANCE, before reading anything", async () => {
    // ESTIMATOR is the one job function that holds neither OWNER nor
    // MANAGE_COMPLIANCE (permissions.ts's BY_FUNCTION table) — the one
    // person this page has nothing for.
    state.role = "MEMBER";
    state.jobFunction = "ESTIMATOR";
    const html = await render();
    expect(html).toContain("Only the account owner can import records");
    expect(state.queried).toEqual([]);
    expect(state.props).toEqual([]);
    expect(state.coiProps).toEqual([]);
    expect(state.registerProps).toEqual([]);
  });

  it("gives a non-owner with MANAGE_COMPLIANCE only the payroll register, scoped to their company", async () => {
    // PAYROLL_COMPLIANCE holds MANAGE_COMPLIANCE but not OWNER — the
    // office manager who runs certified payroll every week, and the whole
    // reason importPayrollRegister is not owner-gated like its siblings.
    state.role = "MEMBER";
    state.jobFunction = "PAYROLL_COMPLIANCE";
    const html = await render();
    expect(html).not.toContain("Only the account owner can import records");
    // None of the owner-only imports were even queried for.
    expect(state.props).toEqual([]);
    expect(state.coiProps).toEqual([]);
    expect(state.registerProps).toHaveLength(1);
    const props = state.registerProps[0] as {
      crew: { legalFirstName: string }[];
      existing: { crewMemberId: string }[];
    };
    expect(props.crew.map((c) => c.legalFirstName)).toEqual(["Maria"]);
    expect(props.existing.map((e) => e.crewMemberId)).toEqual(["crew_maria"]);
    const payload = JSON.stringify(props);
    for (const theirs of ["crew_john", "John", "Smith"]) {
      expect(payload).not.toContain(theirs);
    }
  });

  it("gives the owner all three imports and the payroll register, fed only this company's records", async () => {
    await render();
    expect(state.props.map((p) => p.kind)).toEqual(["clients", "jobs", "crew"]);
    const payload = JSON.stringify(state.props);
    expect(payload).toContain("Acme Builders");
    expect(payload).toContain("Tower");
    expect(payload).toContain("Maria");
    expect(payload).toContain("Priya Shah");
    for (const theirs of ["Zenith GC", "Harbor", "John", "Smith", "E-1", "Wei Chen"]) {
      expect(payload).not.toContain(theirs);
    }
    expect(state.registerProps).toHaveLength(1);
    const registerPayload = JSON.stringify(state.registerProps[0]);
    expect(registerPayload).toContain("crew_maria");
    expect(registerPayload).not.toContain("crew_john");
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
