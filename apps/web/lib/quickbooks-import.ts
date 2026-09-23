import type { QuickBooksAddress, QuickBooksImportItem, QuickBooksImportParty } from "@prova/integrations";
import { catalogKey } from "./catalog-import";
import type { LeftOut } from "./jobber-import";
import {
  FULL_SSN_REFUSAL,
  MAX_IMPORT_ROWS,
  looksLikeEmail,
  mentionsWholeSsn,
  nameKey,
  type ExistingMatch,
  type RowProblem,
} from "./spreadsheet-import";

/**
 * Bringing a contractor's QuickBooks Online customers, vendors and
 * products/services in during onboarding — the same import as
 * /settings/import and the Jobber card, with QuickBooks as the source.
 *
 * ONE-WAY AND ONE-TIME, like the Jobber import (lib/jobber-import.ts). It
 * reads QuickBooks and writes C Stream once per Confirm, never writes to
 * QuickBooks, never pulls again on its own, and never changes a row that is
 * already here. The invoice PUSH to QuickBooks (lib/actions/quickbooks.ts)
 * is a separate thing and is not touched.
 *
 *   QuickBooks Customer -> C Stream client (Contact)
 *   QuickBooks Vendor   -> C Stream vendor (Vendor)
 *   QuickBooks Item     -> catalog entry (LineItemCatalogEntry)
 *
 * Items land in the CATALOG, never on a job. ARCHITECTURE.md: a job's line
 * items are one unified object, and the catalog is the separate list of
 * templates a line is priced from. A QuickBooks product/service is exactly
 * such a template — a name and a price — and says nothing about any job.
 *
 * SAME RULES AS THE OTHER TWO IMPORTERS, and their helpers wherever they
 * fit: names compared by `nameKey` (catalog descriptions by `catalogKey`,
 * the catalog importer's own key), the 500-row cap on what is created, the
 * email check, and the refusal to carry a whole Social Security number.
 *
 * WHERE THE QUICKBOOKS ID LIVES. Not a new column: `QuickBooksEntityLink`
 * already is "our id against QuickBooks' id for the same record", unique
 * both ways per company. An imported client gets the "Contact" link the
 * invoice push already reads — so the first invoice pushed for that client
 * goes to the customer it came from, with its history, instead of a
 * name lookup. Vendors get "Vendor" links and catalog entries
 * "LineItemCatalogEntry" links; nothing pushes those, they exist so a
 * second import recognises its own rows by id after a rename on either
 * side. (Not "Item": that entity type is the invoice push's income item,
 * keyed by a sentinel, and sharing it would collide on the unique index.)
 *
 * Every QuickBooks record lands in exactly one bucket:
 *
 *   create    — written on Confirm;
 *   existing  — already here (same QuickBooks id, or same name), left alone;
 *   leftOut   — deliberately not imported, with the reason;
 *   problems  — could not be imported, with a sentence.
 *
 * Pure: QuickBooks' records and this company's rows in, a plan out. The
 * same function runs for the preview and again inside the confirm's
 * transaction, against a fresh read of both.
 */

export { MAX_IMPORT_ROWS };

/** Most records of one kind read from QuickBooks in one import. */
export const QUICKBOOKS_PULL_LIMIT = 5000;

/** The link entity types this import writes and reads. */
export const QBO_LINK_TYPES = {
  contact: "Contact",
  vendor: "Vendor",
  catalog: "LineItemCatalogEntry",
} as const;

export type QuickBooksPull = {
  customers: QuickBooksImportParty[];
  vendors: QuickBooksImportParty[];
  items: QuickBooksImportItem[];
  truncated: { customers: boolean; vendors: boolean; items: boolean };
};

export type QboLink = { entityId: string; qboId: string };

export type ExistingForQuickBooks = {
  /** OLDEST FIRST — a name matches the original. */
  contacts: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  catalog: { id: string; description: string }[];
  links: { contact: QboLink[]; vendor: QboLink[]; catalog: QboLink[] };
  /** QuickBooks item ids the invoice push itself posts to (its "Item"
   * links). Not a product the contractor sells, so never a catalog line. */
  pushItemIds: string[];
};

export type QboClientRow = {
  qboId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string[];
};

export type QboVendorRow = {
  qboId: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  /** Vendor has no address column; the address goes in its notes. */
  notes: string | null;
  flags: string[];
};

export type QboCatalogRow = {
  qboId: string;
  description: string;
  unitPrice: number | null;
  unitCost: number | null;
  /** What QuickBooks calls it — Service, Inventory, NonInventory. */
  qboType: string | null;
  notes: string[];
};

export type Bucket<R> = { create: R[]; existing: ExistingMatch[]; leftOut: LeftOut[]; problems: RowProblem[] };

export type QuickBooksPlan = {
  clients: Bucket<QboClientRow>;
  vendors: Bucket<QboVendorRow>;
  catalog: Bucket<QboCatalogRow>;
  /** Sentences for the top of the preview: partial reads and the cap. */
  notices: string[];
};

/* ------------------------------------------------------------------ */

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function formatQuickBooksAddress(address: QuickBooksAddress | null | undefined): string | null {
  if (!address) return null;
  const street = [clean(address.line1), clean(address.line2), clean(address.line3)].filter(Boolean).join(", ");
  const region = [clean(address.region), clean(address.postalCode)].filter(Boolean).join(" ");
  const line = [street, clean(address.city), region].filter(Boolean).join(", ");
  return line || null;
}

/** The name a person would recognise: QuickBooks' display name, else the
 * company name, else first and last. */
export function quickBooksPartyName(party: QuickBooksImportParty): string {
  return (
    clean(party.displayName) ||
    clean(party.companyName) ||
    [clean(party.givenName), clean(party.familyName)].filter(Boolean).join(" ")
  );
}

/**
 * The label a preview shows for a record. The record's own name — unless the
 * name is the very thing carrying a whole SSN, in which case it is replaced by
 * the QuickBooks id: a refusal that repeats the number back has put it on
 * screen, which is what refusing it was for.
 */
function safeLabel(name: string, fallback: string): string {
  return name && !mentionsWholeSsn(name) ? name : fallback;
}

/**
 * One kind of record, planned. Written once and used for all three kinds —
 * the only thing that differs between customers, vendors and items is how a
 * record becomes a row and which key compares names.
 *
 * Order matters, and each step is a guard with its own test:
 *   1. left out on purpose (a sub-customer, a category, the push's own item);
 *   2. already linked by QuickBooks id -> existing (or, if the C Stream row
 *      it pointed at was deleted since, left out: a deletion here is a
 *      decision, and an import that brought it back would overrule it);
 *   3. a problem with the record itself (no name, a whole SSN);
 *   4. a second QuickBooks record with the same name in this pull;
 *   5. a C Stream row of the same name -> existing, unless THAT row is
 *      linked to a different QuickBooks record (two people, one name);
 *   6. create.
 */
type Candidate<R> =
  | { kind: "row"; qboId: string; label: string; key: string; row: R }
  | { kind: "leftOut"; qboId: string; label: string; reason: string }
  | { kind: "problem"; qboId: string; label: string; message: string };

function planKind<R>(
  candidates: Candidate<R>[],
  existing: { id: string; name: string }[],
  links: QboLink[],
  keyOf: (name: string) => string,
  noun: { one: string; many: string },
  notices: string[],
): Bucket<R> {
  const bucket: Bucket<R> = { create: [], existing: [], leftOut: [], problems: [] };
  const rowById = new Map(existing.map((row) => [row.id, row]));
  const linkByQbo = new Map(links.map((link) => [link.qboId, link.entityId]));
  const linkByEntity = new Map(links.map((link) => [link.entityId, link.qboId]));
  const byName = new Map<string, { id: string; name: string }>();
  for (const row of existing) {
    const key = keyOf(row.name);
    if (!byName.has(key)) byName.set(key, row);
  }
  const claimed = new Set<string>();

  candidates.forEach((candidate, index) => {
    const line = index + 1;
    if (candidate.kind === "leftOut") {
      bucket.leftOut.push({ label: candidate.label, reason: candidate.reason });
      return;
    }

    const linkedId = linkByQbo.get(candidate.qboId);
    if (linkedId !== undefined) {
      const here = rowById.get(linkedId);
      if (here) {
        bucket.existing.push({
          line,
          label: candidate.kind === "row" && here.name !== candidate.label ? `${candidate.label} (here as ${here.name})` : here.name,
        });
      } else {
        bucket.leftOut.push({
          label: candidate.label,
          reason: "brought in from QuickBooks before and deleted in C Stream since, so it is not brought back",
        });
      }
      return;
    }

    if (candidate.kind === "problem") {
      bucket.problems.push({ line, message: candidate.message });
      return;
    }

    if (claimed.has(candidate.key)) {
      bucket.problems.push({
        line,
        message: `${candidate.label} — another QuickBooks ${noun.one} has the same name, so only the first is added. Rename one of them in QuickBooks and import again to bring this one in.`,
      });
      return;
    }
    claimed.add(candidate.key);

    const namesake = byName.get(candidate.key);
    if (namesake) {
      const namesakeQbo = linkByEntity.get(namesake.id);
      if (namesakeQbo && namesakeQbo !== candidate.qboId) {
        bucket.problems.push({
          line,
          message: `${candidate.label} — ${namesake.name} in C Stream is already linked to a different QuickBooks ${noun.one}. Rename one of them in QuickBooks and import again.`,
        });
        return;
      }
      bucket.existing.push({ line, label: candidate.label });
      return;
    }

    bucket.create.push(candidate.row);
  });

  // The cap applies to what would be CREATED, after matching, so a second
  // run picks up where the first stopped.
  if (bucket.create.length > MAX_IMPORT_ROWS) {
    const over = bucket.create.splice(MAX_IMPORT_ROWS);
    notices.push(
      `Only the first ${MAX_IMPORT_ROWS} new ${noun.many} are added this time — ${over.length} more are left for the next run. Confirm, then import again.`,
    );
  }
  return bucket;
}

/* ------------------------------------------------------------------ */

function customerCandidate(customer: QuickBooksImportParty): Candidate<QboClientRow> {
  const name = quickBooksPartyName(customer);
  const label = safeLabel(name, `QuickBooks customer #${customer.id}`);
  if (customer.isSubCustomer) {
    return {
      kind: "leftOut",
      qboId: customer.id,
      label,
      reason: `a sub-customer${customer.parentName ? ` of ${clean(customer.parentName)}` : ""} — QuickBooks uses those for jobs, and C Stream keeps jobs on their own. Add it as a job under its client.`,
    };
  }
  if (!name) return { kind: "problem", qboId: customer.id, label, message: "A QuickBooks customer with no name — skipped." };

  const phone = clean(customer.phone) || clean(customer.mobile) || null;
  const address = formatQuickBooksAddress(customer.billAddress) ?? formatQuickBooksAddress(customer.shipAddress);
  const emailText = clean(customer.email);
  // Checked before anything about the record is kept, and the message never
  // repeats the value.
  if ([name, phone, address, emailText].some(mentionsWholeSsn)) {
    return { kind: "problem", qboId: customer.id, label, message: `${label} — ${FULL_SSN_REFUSAL}` };
  }
  const notes: string[] = [];
  let email: string | null = null;
  if (emailText) {
    if (looksLikeEmail(emailText)) email = emailText;
    else notes.push(`email "${emailText}" left out — it isn't an address`);
  }
  return {
    kind: "row",
    qboId: customer.id,
    label: name,
    key: nameKey(name),
    row: { qboId: customer.id, name, email, phone, address, notes },
  };
}

function vendorCandidate(vendor: QuickBooksImportParty): Candidate<QboVendorRow> {
  const name = quickBooksPartyName(vendor);
  const label = safeLabel(name, `QuickBooks vendor #${vendor.id}`);
  if (!name) return { kind: "problem", qboId: vendor.id, label, message: "A QuickBooks vendor with no name — skipped." };

  const person = [clean(vendor.givenName), clean(vendor.familyName)].filter(Boolean).join(" ");
  const contactName = person && nameKey(person) !== nameKey(name) ? person : null;
  const phone = clean(vendor.phone) || clean(vendor.mobile) || null;
  const address = formatQuickBooksAddress(vendor.billAddress);
  const emailText = clean(vendor.email);
  if ([name, contactName, phone, address, emailText].some(mentionsWholeSsn)) {
    return { kind: "problem", qboId: vendor.id, label, message: `${label} — ${FULL_SSN_REFUSAL}` };
  }
  const flags: string[] = [];
  let email: string | null = null;
  if (emailText) {
    if (looksLikeEmail(emailText)) email = emailText;
    else flags.push(`email "${emailText}" left out — it isn't an address`);
  }
  return {
    kind: "row",
    qboId: vendor.id,
    label: name,
    key: nameKey(name),
    row: { qboId: vendor.id, name, contactName, email, phone, notes: address ? `Address: ${address}` : null, flags },
  };
}

/** Item types that are not something a contractor prices work from. */
const ITEM_LEFT_OUT: Record<string, string> = {
  category: "a category in QuickBooks — a heading for other items, not something you sell",
  group: "a bundle of other items in QuickBooks — the items inside it come across on their own",
};

function itemCandidate(item: QuickBooksImportItem, pushItemIds: Set<string>): Candidate<QboCatalogRow> {
  const description = clean(item.fullyQualifiedName) || clean(item.name);
  const label = safeLabel(description, `QuickBooks item #${item.id}`);
  const typeReason = item.type ? ITEM_LEFT_OUT[item.type.toLowerCase()] : undefined;
  if (typeReason) return { kind: "leftOut", qboId: item.id, label, reason: typeReason };
  if (pushItemIds.has(item.id)) {
    return {
      kind: "leftOut",
      qboId: item.id,
      label,
      reason: "the item C Stream's own invoice push books to — not one of your products",
    };
  }
  if (!description) return { kind: "problem", qboId: item.id, label, message: "A QuickBooks item with no name — skipped." };
  if (mentionsWholeSsn(description)) {
    return { kind: "problem", qboId: item.id, label, message: `${label} — ${FULL_SSN_REFUSAL}` };
  }
  const notes: string[] = [];
  const price = (value: number | null, what: string) => {
    if (value == null || value === 0) return null;
    if (value < 0 || !Number.isFinite(value)) {
      notes.push(`${what} left out — QuickBooks has it below zero`);
      return null;
    }
    return Math.round(value * 100) / 100;
  };
  return {
    kind: "row",
    qboId: item.id,
    label: description,
    key: catalogKey(description),
    row: {
      qboId: item.id,
      description,
      unitPrice: price(item.unitPrice, "price"),
      unitCost: price(item.purchaseCost, "cost"),
      qboType: item.type,
      notes,
    },
  };
}

export function planQuickBooksImport(pull: QuickBooksPull, existing: ExistingForQuickBooks): QuickBooksPlan {
  const notices: string[] = [];
  const kinds: [keyof QuickBooksPull["truncated"], string][] = [
    ["customers", "customers"],
    ["vendors", "vendors"],
    ["items", "products and services"],
  ];
  for (const [key, word] of kinds) {
    if (pull.truncated[key]) {
      notices.push(
        `QuickBooks has more than ${QUICKBOOKS_PULL_LIMIT} ${word}, and C Stream reads the first ${QUICKBOOKS_PULL_LIMIT}. Anything after that is not in this preview, and running the import again will not reach it.`,
      );
    }
  }

  const pushItemIds = new Set(existing.pushItemIds);
  const clients = planKind(
    pull.customers.map(customerCandidate),
    existing.contacts,
    existing.links.contact,
    nameKey,
    { one: "customer", many: "clients" },
    notices,
  );
  const vendors = planKind(
    pull.vendors.map(vendorCandidate),
    existing.vendors,
    existing.links.vendor,
    nameKey,
    { one: "vendor", many: "vendors" },
    notices,
  );
  const catalog = planKind(
    pull.items.map((item) => itemCandidate(item, pushItemIds)),
    existing.catalog.map((entry) => ({ id: entry.id, name: entry.description })),
    existing.links.catalog,
    catalogKey,
    { one: "product or service", many: "catalog entries" },
    notices,
  );

  return { clients, vendors, catalog, notices };
}

/** The sentence a confirm returns. */
export function quickBooksSummarySentence(
  added: { clients: number; vendors: number; catalog: number },
  alreadyThere: number,
): string {
  if (added.clients + added.vendors + added.catalog === 0) {
    return "Nothing new to add — everything from QuickBooks is already in C Stream.";
  }
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    `Added ${count(added.clients, "client", "clients")}, ${count(added.vendors, "vendor", "vendors")} and ${count(
      added.catalog,
      "catalog entry",
      "catalog entries",
    )} from QuickBooks.`,
  ];
  if (alreadyThere > 0) parts.push(`${alreadyThere} already here and left alone.`);
  return parts.join(" ");
}
