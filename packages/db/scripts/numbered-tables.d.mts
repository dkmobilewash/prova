/**
 * Types for numbered-tables.mjs.
 *
 * The implementation is plain .mjs because everything in this directory runs
 * under bare `node` with no build step. These declarations exist so the
 * census in apps/web/lib and the database test that exercises the seed both
 * typecheck against it rather than importing an implicit `any` — which
 * matters here for the usual reason: the thing being described decides which
 * column a counter has to agree with, and a `Record<string, any>` stops
 * catching a renamed field the moment somebody adds one.
 */

export type NumberedTable = {
  /** Prisma delegate of the NUMBERED table, e.g. `invoice`. */
  accessor: string;
  /** The function app code must issue that number from. */
  helper: string;
  /** Prisma delegate of the counter row, e.g. `invoiceCounter`. */
  counterAccessor: string;
  /** The numbered column on the row, e.g. `number`, `caseNumber`. */
  numberField: string;
  /** The high-water column on the counter, e.g. `lastNumber`. */
  counterField: string;
  /** What the counter is keyed on. Only SafetyCaseCounter is company-scoped. */
  scope: "job" | "company";
};

/** Keyed by counter MODEL name, e.g. `InvoiceCounter`. */
export const NUMBERED_TABLES: Record<string, NumberedTable>;
