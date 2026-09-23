import { describe, expect, it } from "vitest";
import type { QuickBooksImportItem, QuickBooksImportParty } from "@prova/integrations";
import {
  MAX_IMPORT_ROWS,
  formatQuickBooksAddress,
  planQuickBooksImport,
  quickBooksSummarySentence,
  type ExistingForQuickBooks,
  type QuickBooksPull,
} from "./quickbooks-import";
import { FULL_SSN_REFUSAL } from "./spreadsheet-import";

/** The planner on its own: QuickBooks records in, buckets out. Nothing here
 * talks to QuickBooks or a database — lib/actions/quickbooksImport.test.ts
 * does that. */

function party(id: string, displayName: string | null, more: Partial<QuickBooksImportParty> = {}): QuickBooksImportParty {
  return {
    id,
    displayName,
    companyName: null,
    givenName: null,
    familyName: null,
    email: null,
    phone: null,
    mobile: null,
    billAddress: null,
    shipAddress: null,
    parentName: null,
    isSubCustomer: false,
    ...more,
  };
}

function item(id: string, name: string, more: Partial<QuickBooksImportItem> = {}): QuickBooksImportItem {
  return { id, name, fullyQualifiedName: name, type: "Service", unitPrice: null, purchaseCost: null, ...more };
}

function pull(partial: Partial<QuickBooksPull>): QuickBooksPull {
  return { customers: [], vendors: [], items: [], truncated: { customers: false, vendors: false, items: false }, ...partial };
}

function existing(partial: Partial<ExistingForQuickBooks> = {}): ExistingForQuickBooks {
  return {
    contacts: [],
    vendors: [],
    catalog: [],
    links: { contact: [], vendor: [], catalog: [] },
    pushItemIds: [],
    ...partial,
  };
}

const SSN = "123-45-6789";

describe("customers -> clients", () => {
  it("takes the display name, else the company name, else first and last", () => {
    const plan = planQuickBooksImport(
      pull({
        customers: [
          party("1", "Turner Construction"),
          party("2", null, { companyName: "Hensel Phelps" }),
          party("3", null, { givenName: "Ana", familyName: "Ruiz" }),
        ],
      }),
      existing(),
    );
    expect(plan.clients.create.map((row) => row.name)).toEqual(["Turner Construction", "Hensel Phelps", "Ana Ruiz"]);
  });

  it("carries email, phone (mobile when there is no phone) and the billing address, else the shipping one", () => {
    const plan = planQuickBooksImport(
      pull({
        customers: [
          party("1", "A", {
            email: "ap@a.com",
            mobile: "303-555-0100",
            billAddress: { line1: "1 Main St", line2: null, line3: null, city: "Denver", region: "CO", postalCode: "80202" },
          }),
          party("2", "B", {
            phone: "303-555-0101",
            shipAddress: { line1: "9 Yard Rd", line2: null, line3: null, city: "Golden", region: "CO", postalCode: null },
          }),
        ],
      }),
      existing(),
    );
    expect(plan.clients.create[0]).toMatchObject({ email: "ap@a.com", phone: "303-555-0100", address: "1 Main St, Denver, CO 80202" });
    expect(plan.clients.create[1]).toMatchObject({ phone: "303-555-0101", address: "9 Yard Rd, Golden, CO" });
  });

  it("drops an email that is not an address, and says so", () => {
    const plan = planQuickBooksImport(pull({ customers: [party("1", "A", { email: "call the office" })] }), existing());
    expect(plan.clients.create[0].email).toBeNull();
    expect(plan.clients.create[0].notes[0]).toMatch(/isn't an address/);
  });

  it("leaves a sub-customer (a QuickBooks job) out on purpose, naming its parent", () => {
    const plan = planQuickBooksImport(
      pull({ customers: [party("1", "Turner Construction"), party("2", "Tower B", { isSubCustomer: true, parentName: "Turner Construction" })] }),
      existing(),
    );
    expect(plan.clients.create.map((row) => row.qboId)).toEqual(["1"]);
    expect(plan.clients.leftOut).toEqual([{ label: "Tower B", reason: expect.stringMatching(/sub-customer of Turner Construction/) }]);
  });

  it("refuses a record carrying a whole SSN, anywhere, without repeating it", () => {
    const plan = planQuickBooksImport(
      pull({
        customers: [
          party("1", `Smith ${SSN}`),
          party("2", "Jones", { phone: SSN }),
          party("3", "Lee", { billAddress: { line1: `SSN ${SSN}`, line2: null, line3: null, city: null, region: null, postalCode: null } }),
          party("4", "Ok"),
        ],
      }),
      existing(),
    );
    expect(plan.clients.create.map((row) => row.qboId)).toEqual(["4"]);
    expect(plan.clients.problems).toHaveLength(3);
    for (const problem of plan.clients.problems) {
      expect(problem.message).toContain(FULL_SSN_REFUSAL);
    }
    expect(plan.clients.problems.map((p) => p.message).join(" ")).not.toContain(SSN.slice(4));
    expect(JSON.stringify(plan.clients.create)).not.toContain(SSN);
  });

  it("a phone number (3-3-4) is not mistaken for an SSN", () => {
    const plan = planQuickBooksImport(pull({ customers: [party("1", "A", { phone: "303-555-0100" })] }), existing());
    expect(plan.clients.create).toHaveLength(1);
  });

  it("recognises its own client by QuickBooks id after a rename on either side", () => {
    const plan = planQuickBooksImport(
      pull({ customers: [party("7", "Turner Construction Co")] }),
      existing({ contacts: [{ id: "c1", name: "Turner" }], links: { contact: [{ entityId: "c1", qboId: "7" }], vendor: [], catalog: [] } }),
    );
    expect(plan.clients.create).toEqual([]);
    expect(plan.clients.existing).toEqual([{ line: 1, label: "Turner Construction Co (here as Turner)" }]);
  });

  it("does not bring back a client that was imported and then deleted in C Stream", () => {
    const plan = planQuickBooksImport(
      pull({ customers: [party("7", "Turner")] }),
      existing({ links: { contact: [{ entityId: "gone", qboId: "7" }], vendor: [], catalog: [] } }),
    );
    expect(plan.clients.create).toEqual([]);
    expect(plan.clients.leftOut[0].reason).toMatch(/deleted in C Stream/);
  });

  it("matches a hand-typed client by name, ignoring case and spacing, and leaves it alone", () => {
    const plan = planQuickBooksImport(pull({ customers: [party("7", "turner  construction")] }), existing({ contacts: [{ id: "c1", name: "Turner Construction" }] }));
    expect(plan.clients.create).toEqual([]);
    expect(plan.clients.existing).toHaveLength(1);
  });

  it("does not treat a namesake linked to a DIFFERENT QuickBooks customer as the same one", () => {
    const plan = planQuickBooksImport(
      pull({ customers: [party("8", "John Smith")] }),
      existing({ contacts: [{ id: "c1", name: "John Smith" }], links: { contact: [{ entityId: "c1", qboId: "7" }], vendor: [], catalog: [] } }),
    );
    expect(plan.clients.existing).toEqual([]);
    expect(plan.clients.problems[0].message).toMatch(/different QuickBooks customer/);
  });

  it("never merges two QuickBooks customers who share a name — the second is refused with a reason", () => {
    const plan = planQuickBooksImport(pull({ customers: [party("1", "John Smith"), party("2", "JOHN SMITH")] }), existing());
    expect(plan.clients.create.map((row) => row.qboId)).toEqual(["1"]);
    expect(plan.clients.problems[0].message).toMatch(/same name/);
  });

  it("caps what is CREATED at the import limit, and says how many are left for the next run", () => {
    const customers = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => party(String(i + 1), `Client ${i + 1}`));
    const plan = planQuickBooksImport(pull({ customers }), existing());
    expect(plan.clients.create).toHaveLength(MAX_IMPORT_ROWS);
    expect(plan.notices.join(" ")).toMatch(/3 more are left for the next run/);
  });

  it("says plainly when QuickBooks had more records than were read", () => {
    const plan = planQuickBooksImport(pull({ truncated: { customers: true, vendors: false, items: false } }), existing());
    expect(plan.notices[0]).toMatch(/more than 5000 customers/);
  });
});

describe("vendors", () => {
  it("keeps a contact person only when it is not just the vendor's name again, and puts the address in notes", () => {
    const plan = planQuickBooksImport(
      pull({
        vendors: [
          party("1", "ABC Supply", { givenName: "Pat", familyName: "Doe", billAddress: { line1: "5 Dock St", line2: null, line3: null, city: "Aurora", region: "CO", postalCode: null } }),
          party("2", "Pat Doe", { givenName: "Pat", familyName: "Doe" }),
        ],
      }),
      existing(),
    );
    expect(plan.vendors.create[0]).toMatchObject({ name: "ABC Supply", contactName: "Pat Doe", notes: "Address: 5 Dock St, Aurora, CO" });
    expect(plan.vendors.create[1].contactName).toBeNull();
  });

  it("applies the SSN refusal to vendors too — a sole proprietor's number typed into a field", () => {
    const plan = planQuickBooksImport(pull({ vendors: [party("1", "Joe Drywall", { givenName: `Joe ${SSN}` })] }), existing());
    expect(plan.vendors.create).toEqual([]);
    expect(plan.vendors.problems[0].message).toContain(FULL_SSN_REFUSAL);
  });

  it("matches by its own link first, then by name", () => {
    const plan = planQuickBooksImport(
      pull({ vendors: [party("1", "ABC Supply Inc"), party("2", "Home Depot")] }),
      existing({
        vendors: [
          { id: "v1", name: "ABC" },
          { id: "v2", name: "home depot" },
        ],
        links: { contact: [], vendor: [{ entityId: "v1", qboId: "1" }], catalog: [] },
      }),
    );
    expect(plan.vendors.create).toEqual([]);
    expect(plan.vendors.existing.map((e) => e.label)).toEqual(["ABC Supply Inc (here as ABC)", "Home Depot"]);
  });
});

describe("items -> catalog", () => {
  it("brings services and products in with price and cost, using the full name", () => {
    const plan = planQuickBooksImport(
      pull({ items: [item("1", "Hang", { fullyQualifiedName: "Drywall:Hang", unitPrice: 1.254, purchaseCost: 0.8 }), item("2", "Board", { type: "Inventory" })] }),
      existing(),
    );
    expect(plan.catalog.create[0]).toMatchObject({ description: "Drywall:Hang", unitPrice: 1.25, unitCost: 0.8 });
    expect(plan.catalog.create[1]).toMatchObject({ description: "Board", unitPrice: null, unitCost: null, qboType: "Inventory" });
  });

  it("leaves categories, bundles and the invoice push's own item out on purpose", () => {
    const plan = planQuickBooksImport(
      pull({ items: [item("1", "Drywall", { type: "Category" }), item("2", "Kit", { type: "Group" }), item("3", "Prova — Construction services"), item("4", "Tape")] }),
      existing({ pushItemIds: ["3"] }),
    );
    expect(plan.catalog.create.map((row) => row.qboId)).toEqual(["4"]);
    expect(plan.catalog.leftOut.map((row) => row.reason)).toEqual([
      expect.stringMatching(/category/),
      expect.stringMatching(/bundle/),
      expect.stringMatching(/invoice push/),
    ]);
  });

  it("drops a negative price with a note rather than writing it", () => {
    const plan = planQuickBooksImport(pull({ items: [item("1", "Credit", { unitPrice: -50 })] }), existing());
    expect(plan.catalog.create[0].unitPrice).toBeNull();
    expect(plan.catalog.create[0].notes[0]).toMatch(/below zero/);
  });

  it("matches the catalog the way the catalog importer does — description, ignoring case", () => {
    const plan = planQuickBooksImport(pull({ items: [item("1", "5/8 Type X Board")] }), existing({ catalog: [{ id: "e1", description: "5/8 type x board" }] }));
    expect(plan.catalog.create).toEqual([]);
    expect(plan.catalog.existing).toHaveLength(1);
  });
});

describe("bits", () => {
  it("formats an address and returns null for an empty one", () => {
    expect(formatQuickBooksAddress({ line1: " 1  Main ", line2: "Ste 2", line3: null, city: "Denver", region: "CO", postalCode: "80202" })).toBe(
      "1 Main, Ste 2, Denver, CO 80202",
    );
    expect(formatQuickBooksAddress({ line1: null, line2: null, line3: null, city: null, region: null, postalCode: null })).toBeNull();
  });

  it("the summary sentence", () => {
    expect(quickBooksSummarySentence({ clients: 0, vendors: 0, catalog: 0 }, 4)).toMatch(/Nothing new to add/);
    expect(quickBooksSummarySentence({ clients: 1, vendors: 2, catalog: 3 }, 4)).toBe(
      "Added 1 client, 2 vendors and 3 catalog entries from QuickBooks. 4 already here and left alone.",
    );
  });
});
