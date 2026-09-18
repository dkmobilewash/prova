### A new contractor can bring their QuickBooks customers, vendors and products in — read-only, previewed, once (Cyrus)
`cyrus/qbo-import`

QuickBooks only ever PUSHED invoices. A contractor starting on C Stream with
years of customers, suppliers and a price list in QuickBooks Online had to
type them again. Now Settings → QuickBooks Online has **Import from
QuickBooks**: customers become clients, vendors become vendors, products and
services become **catalog** entries (never job lines — ARCHITECTURE.md keeps
`Job`/`JobLineItem` one object and the catalog the separate list of
templates). Linked from /settings/import and the getting-started step.

**Not a third importer.** Same rules and helpers as the Jobber and spreadsheet
imports: `nameKey`/`catalogKey` matching, the 500-new-rows cap, the email
check, the whole-SSN refusal, the Serializable confirm that reads QuickBooks
AGAIN and plans again inside the transaction (nothing from the browser decides
what is written, so the 1 MB Server Action limit cannot bite), and the
Jobber/spreadsheet preview pieces (`Counts`, `LeftOutList`, `ExistingList`,
`Problems`). The token comes from the invoice push's own refresh code, moved
unchanged into `lib/quickbooks-token.ts` because a `"use server"` file cannot
export a function that returns a bearer token.

**No migration.** The QuickBooks id lives in the existing
`QuickBooksEntityLink`, unique both ways per company — "Contact", "Vendor" and
"LineItemCatalogEntry" links. An imported client's Contact link is the one the
invoice push already reads, so its first invoice goes to the customer it came
from instead of a name lookup. Not "Item": that type is the push's own income
item, and the import leaves that item out of the catalog.

**Read-only toward QuickBooks, by test.** Every Accounting-API request from
preview and confirm must be a GET, and there must be some; the only POST
anywhere is the OAuth refresh. The vendor tax id is dropped at the
integration boundary and never reaches the plan.

Found while writing it: a refusal message that repeats a record's NAME puts a
whole SSN on screen when the name is where the number was typed. Here the
label falls back to the QuickBooks id. `lib/jobber-import.ts` still echoes the
name — not touched in this PR.

**Public pages Intuit asks for before production keys:** `/privacy`, `/terms`
and `/quickbooks/disconnected` (the Disconnect URL). Written from the code —
every service named is one the app calls, and nothing is promised the code
does not do. Not lawyer-reviewed.

Tests: `quickbooks-import.test.ts` (planner, 22), `actions/quickbooksImport.test.ts`
(16, against a fake database of two companies and a fake QuickBooks that pages
by STARTPOSITION/MAXRESULTS, rotates refresh tokens and scopes tokens to a
realm), `components/quickBooksImport.test.ts` (4, rendered). Sixteen
mutations — owner guard, capability guard, match-by-link, SSN refusal,
paging, the limit probe, reads-by-POST, cross-tenant links, a preview write,
no refresh, no cap, links mapped by position, not Serializable, sub-customers,
the push item, the SSN echo — 16 requested, 16 returned, 16 red.

Not yet run against the real sandbox company: `ORDERBY DisplayName`/`Name` is
from Intuit's entity reference (Id is filterable but not sortable). The
click-list in the PR is the first live run.
