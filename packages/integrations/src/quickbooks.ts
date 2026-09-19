// QuickBooks Online OAuth 2.0 client — authorization_code flow only.
//
// Scope decision (see ARCHITECTURE.md "QuickBooks / accounting sync"): this
// connects accounting data only. QuickBooks Payments is intentionally not
// requested — this app has its own manual Payment records (see Invoice /
// Payment models) and isn't wired to charge cards through Intuit.
//
// All endpoints below are Intuit's documented OAuth 2.0 / Accounting API /
// OpenID Connect endpoints — nothing here is invented.
// https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0

import {
  MAX_ATTEMPTS,
  backoffMs,
  isRetryableStatus,
  parseRetryAfter,
  type RequestKind,
} from "./quickbooks-retry";

/** Waits, so a retry is a retry rather than a second burst. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const QUICKBOOKS_SCOPES = "com.intuit.quickbooks.accounting openid profile email phone address";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export type QuickBooksEnvironment = "sandbox" | "production";

export interface QuickBooksConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: QuickBooksEnvironment;
}

/// Reads connection config from environment variables. Called at the start
/// of every function below rather than once at module load, so a missing
/// env var fails the specific request that needed it instead of crashing
/// module import for unrelated code.
export function readQuickBooksConfig(): QuickBooksConfig {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
  const environment = process.env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing QuickBooks config: QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, and QUICKBOOKS_REDIRECT_URI must all be set.",
    );
  }

  return { clientId, clientSecret, redirectUri, environment };
}

function accountingApiBase(environment: QuickBooksEnvironment): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function userInfoUrl(environment: QuickBooksEnvironment): string {
  return environment === "production"
    ? "https://accounts.platform.intuit.com/v1/openid_connect/userinfo"
    : "https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo";
}

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

interface TokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds, access token
  x_refresh_token_expires_in: number; // seconds, refresh token
  token_type: string;
}

function toQuickBooksTokens(body: TokenEndpointResponse): QuickBooksTokens {
  const now = Date.now();
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    accessTokenExpiresAt: new Date(now + body.expires_in * 1000),
    refreshTokenExpiresAt: new Date(now + body.x_refresh_token_expires_in * 1000),
  };
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

async function parseTokenErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  return `QuickBooks token endpoint returned ${response.status}: ${text}`;
}

/// Builds the URL to redirect the user to for the Intuit consent screen.
/// `state` should be a random, unguessable value the caller has bound to
/// this request (e.g. a short-lived signed cookie) and re-verified when the
/// callback comes back, as CSRF protection.
export function getAuthorizeUrl(state: string): string {
  const config = readQuickBooksConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: QUICKBOOKS_SCOPES,
    redirect_uri: config.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/// Exchanges the authorization code from the callback for an access +
/// refresh token pair.
export async function exchangeCodeForTokens(code: string): Promise<QuickBooksTokens> {
  const config = readQuickBooksConfig();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }

  const body = (await response.json()) as TokenEndpointResponse;
  return toQuickBooksTokens(body);
}

/// Exchanges a still-valid refresh token for a new access + refresh token
/// pair. QuickBooks rotates the refresh token on every use — the caller
/// must persist the new one, not just the new access token.
export async function refreshTokens(refreshToken: string): Promise<QuickBooksTokens> {
  const config = readQuickBooksConfig();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }

  const body = (await response.json()) as TokenEndpointResponse;
  return toQuickBooksTokens(body);
}

/// Revokes an access or refresh token, ending the connection on Intuit's
/// side. Call with the refresh token to invalidate the whole connection.
export async function revokeToken(token: string): Promise<void> {
  const config = readQuickBooksConfig();

  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(config.clientId, config.clientSecret),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    throw new Error(await parseTokenErrorBody(response));
  }
}

export interface QuickBooksCompanyInfo {
  companyName: string;
  legalName?: string;
  country?: string;
}

/// Fetches basic company info — used as the "test connectivity" call, since
/// it's read-only, cheap, and confirms both the access token and realmId
/// are valid together.
export async function getCompanyInfo(
  realmId: string,
  accessToken: string,
): Promise<QuickBooksCompanyInfo> {
  const config = readQuickBooksConfig();
  const url = `${accountingApiBase(config.environment)}/v3/company/${realmId}/companyinfo/${realmId}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks companyinfo request returned ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    CompanyInfo: { CompanyName: string; LegalName?: string; Country?: string };
  };

  return {
    companyName: body.CompanyInfo.CompanyName,
    legalName: body.CompanyInfo.LegalName,
    country: body.CompanyInfo.Country,
  };
}

export interface QuickBooksUserInfo {
  sub: string;
  email?: string;
  givenName?: string;
  familyName?: string;
}

/// Fetches the OpenID Connect userinfo for the person who authorized the
/// connection — not currently persisted, but useful for a one-time "you
/// connected as X" confirmation.
export async function getUserInfo(accessToken: string): Promise<QuickBooksUserInfo> {
  const config = readQuickBooksConfig();

  const response = await fetch(userInfoUrl(config.environment), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`QuickBooks userinfo request returned ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    sub: string;
    email?: string;
    givenName?: string;
    familyName?: string;
  };

  return {
    sub: body.sub,
    email: body.email,
    givenName: body.givenName,
    familyName: body.familyName,
  };
}

/* ------------------------------------------------------------------ */
/* Writing to QuickBooks                                               */
/* ------------------------------------------------------------------ */

/**
 * Everything below writes, or reads back something we wrote.
 *
 * The payload shapes are built in apps/web/lib/quickbooks-sync.ts, which is
 * pure and tested. This layer is deliberately thin: it knows how to talk to
 * Intuit and nothing about what an invoice means, so the part that decides
 * amounts can be tested without a sandbox.
 */

/** A QuickBooks API failure, carrying the status and Intuit's own message
 * so a sync log entry can say something more useful than "it failed". */
export class QuickBooksApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`QuickBooks returned ${status}: ${detail}`);
    this.name = "QuickBooksApiError";
  }
}

async function accountingRequest<T>(
  realmId: string,
  accessToken: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const config = readQuickBooksConfig();
  const url = `${accountingApiBase(config.environment)}/v3/company/${realmId}${path}`;
  // A POST here is a write, and the retry rules differ sharply — see
  // apps/web/lib/quickbooks-retry.ts. The short version: a write is retried
  // only on a status that proves QuickBooks did no work, because retrying
  // one that may already have landed makes a second document.
  const kind: RequestKind = init.method === "GET" ? "read" : "write";

  let response: Response;
  let text: string;
  let attempt = 1;

  for (;;) {
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (error) {
      // No response at all, so no round trip completed and QuickBooks
      // cannot have created something whose id we then lost. Safe to repeat
      // even for a write — narrowly, and only this case.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt));
        attempt += 1;
        continue;
      }
      throw error;
    }

    text = await response.text();
    if (response.ok) break;

    if (attempt < MAX_ATTEMPTS && isRetryableStatus(response.status, kind)) {
      await sleep(
        backoffMs(attempt, {
          retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
        }),
      );
      attempt += 1;
      continue;
    }
    break;
  }

  if (!response.ok) {
    // Intuit puts the useful part in a nested Fault; fall back to the raw
    // body rather than swallowing it, but never log headers — they carry
    // the bearer token.
    let detail = text;
    try {
      const parsed = JSON.parse(text) as {
        Fault?: { Error?: { Message?: string; Detail?: string }[] };
      };
      const first = parsed.Fault?.Error?.[0];
      if (first) detail = [first.Message, first.Detail].filter(Boolean).join(" — ");
    } catch {
      // keep the raw text
    }
    throw new QuickBooksApiError(response.status, detail);
  }

  return JSON.parse(text) as T;
}

export interface QuickBooksAccount {
  id: string;
  name: string;
  accountType: string;
  accountSubType?: string;
}

/** The company's chart of accounts, for the mapping UI. Read-only. */
export async function listAccounts(
  realmId: string,
  accessToken: string,
): Promise<QuickBooksAccount[]> {
  const query = encodeURIComponent(
    "select Id, Name, AccountType, AccountSubType from Account where Active = true maxresults 500",
  );
  const body = await accountingRequest<{
    QueryResponse?: {
      Account?: { Id: string; Name: string; AccountType: string; AccountSubType?: string }[];
    };
  }>(realmId, accessToken, `/query?query=${query}`);

  return (body.QueryResponse?.Account ?? []).map((a) => ({
    id: a.Id,
    name: a.Name,
    accountType: a.AccountType,
    accountSubType: a.AccountSubType,
  }));
}

export interface QuickBooksCustomer {
  id: string;
  displayName: string;
}

/** Finds a customer by exact display name. Used to link an existing GC
 * rather than creating a duplicate of one the bookkeeper already has. */
export async function findCustomerByName(
  realmId: string,
  accessToken: string,
  displayName: string,
): Promise<QuickBooksCustomer | null> {
  // Intuit's query language takes single-quoted literals and has no
  // parameter binding, so an apostrophe in a company name has to be
  // doubled or the query is malformed. "O'Brien Construction" is a real
  // name, not an edge case.
  const escaped = displayName.replace(/'/g, "''");
  const query = encodeURIComponent(
    `select Id, DisplayName from Customer where DisplayName = '${escaped}'`,
  );
  const body = await accountingRequest<{
    QueryResponse?: { Customer?: { Id: string; DisplayName: string }[] };
  }>(realmId, accessToken, `/query?query=${query}`);

  const found = body.QueryResponse?.Customer?.[0];
  return found ? { id: found.Id, displayName: found.DisplayName } : null;
}

export async function createCustomer(
  realmId: string,
  accessToken: string,
  displayName: string,
): Promise<QuickBooksCustomer> {
  const body = await accountingRequest<{ Customer: { Id: string; DisplayName: string } }>(
    realmId,
    accessToken,
    "/customer",
    { method: "POST", body: { DisplayName: displayName } },
  );
  return { id: body.Customer.Id, displayName: body.Customer.DisplayName };
}

export interface QuickBooksInvoice {
  Id: string;
  SyncToken?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Line?: { Amount?: number }[];
}

/** Creates or updates an invoice. QuickBooks uses the same endpoint for
 * both and distinguishes them by whether Id/SyncToken are present. */
export async function upsertInvoice(
  realmId: string,
  accessToken: string,
  payload: unknown,
): Promise<QuickBooksInvoice> {
  const body = await accountingRequest<{ Invoice: QuickBooksInvoice }>(
    realmId,
    accessToken,
    "/invoice",
    { method: "POST", body: payload },
  );
  return body.Invoice;
}

/**
 * Every invoice QuickBooks holds under a given DocNumber.
 *
 * THE NATURAL KEY, AND THE ONLY THING THAT SURVIVES A LOST RESPONSE.
 *
 * `QuickBooksEntityLink` is how a push knows to update rather than create,
 * and it is written by us AFTER QuickBooks has already created the
 * document. Between those two moments there are failures no ordering can
 * remove: the transport retry above can re-POST after a rejection that
 * arrived once the request bytes were already sent, and a serverless
 * function can be killed outright. Either way QuickBooks holds an invoice
 * whose id reached nobody, and the next push would create a second one.
 *
 * `docNumberFor` is deterministic from the Prova invoice's id and number
 * (apps/web/lib/quickbooks-sync.ts), so it is the SAME string on every
 * attempt at the same invoice and distinct for every other one. That makes
 * it the one identifier both systems can agree on without either having
 * told the other anything.
 *
 * Returns a LIST, deliberately. QuickBooks companies with the duplicate
 * document-number check switched off can hold two invoices under one
 * number — which is precisely the damage the bug this exists for produces —
 * and picking one of them here would be a silent guess about which entry in
 * somebody's ledger is the real one. The caller refuses instead.
 */
export async function findInvoicesByDocNumber(
  realmId: string,
  accessToken: string,
  docNumber: string,
): Promise<QuickBooksInvoice[]> {
  // Single-quoted literals with no parameter binding, same as the customer
  // and item lookups: an apostrophe has to be doubled or the query is
  // malformed. DocNumbers here are generated, but escaping on the way in is
  // cheaper than assuming that stays true.
  const escaped = docNumber.replace(/'/g, "''");
  const query = encodeURIComponent(
    `select Id, SyncToken, DocNumber, TotalAmt from Invoice where DocNumber = '${escaped}'`,
  );
  const body = await accountingRequest<{
    QueryResponse?: { Invoice?: QuickBooksInvoice[] };
  }>(realmId, accessToken, `/query?query=${query}`);

  return body.QueryResponse?.Invoice ?? [];
}

/**
 * Reads an invoice back.
 *
 * This is the whole point of the sync design: the response to a write is
 * not treated as proof the write is correct. This project has already been
 * burned by a tool reporting success against something nobody read.
 */
export async function getInvoice(
  realmId: string,
  accessToken: string,
  qboId: string,
): Promise<QuickBooksInvoice> {
  const body = await accountingRequest<{ Invoice: QuickBooksInvoice }>(
    realmId,
    accessToken,
    `/invoice/${encodeURIComponent(qboId)}`,
  );
  return body.Invoice;
}

export interface QuickBooksPayment {
  Id: string;
  SyncToken?: string;
  TotalAmt?: number;
  Line?: { Amount?: number; LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[];
}

/**
 * Creates or updates a Payment applied to an invoice.
 *
 * Same endpoint for both, same rule as the invoice: Id and SyncToken present
 * means update, absent means create.
 *
 * This is the Payment ENTITY in the Accounting API, not Intuit's
 * card-processing product — see the scope note at the top of this file. The
 * accounting scope this connection already holds covers it, so adding this
 * costs nobody a re-consent.
 */
export async function upsertPayment(
  realmId: string,
  accessToken: string,
  payload: unknown,
): Promise<QuickBooksPayment> {
  const body = await accountingRequest<{ Payment: QuickBooksPayment }>(
    realmId,
    accessToken,
    "/payment",
    { method: "POST", body: payload },
  );
  return body.Payment;
}

/** Reads a payment back, for the same reason getInvoice exists: the
 * response to a write is not proof the write is correct. */
export async function getPayment(
  realmId: string,
  accessToken: string,
  qboId: string,
): Promise<QuickBooksPayment> {
  const body = await accountingRequest<{ Payment: QuickBooksPayment }>(
    realmId,
    accessToken,
    `/payment/${encodeURIComponent(qboId)}`,
  );
  return body.Payment;
}

export interface QuickBooksItem {
  id: string;
  name: string;
}

/**
 * A QuickBooks Product/Service item.
 *
 * Distinct from an Account, and the distinction matters: an invoice line
 * references an ITEM, and the item is what posts to an income account.
 * Sending an account id where an item id belongs is not a near miss — they
 * are different objects with different id spaces, and QuickBooks will
 * either reject it or resolve it to the wrong thing.
 */
export async function findItemByName(
  realmId: string,
  accessToken: string,
  name: string,
): Promise<QuickBooksItem | null> {
  const escaped = name.replace(/'/g, "''");
  const query = encodeURIComponent(`select Id, Name from Item where Name = '${escaped}'`);
  const body = await accountingRequest<{
    QueryResponse?: { Item?: { Id: string; Name: string }[] };
  }>(realmId, accessToken, `/query?query=${query}`);

  const found = body.QueryResponse?.Item?.[0];
  return found ? { id: found.Id, name: found.Name } : null;
}

/**
 * Creates a Service item posting to the given income account.
 *
 * Service rather than Inventory deliberately: an inventory item needs
 * quantities, an asset account and a cost of goods account, none of which
 * describe billing a GC for completed work.
 */
export async function createServiceItem(
  realmId: string,
  accessToken: string,
  name: string,
  incomeAccountId: string,
): Promise<QuickBooksItem> {
  const body = await accountingRequest<{ Item: { Id: string; Name: string } }>(
    realmId,
    accessToken,
    "/item",
    {
      method: "POST",
      body: {
        Name: name,
        Type: "Service",
        IncomeAccountRef: { value: incomeAccountId },
      },
    },
  );
  return { id: body.Item.Id, name: body.Item.Name };
}

/**
 * Fetches many invoices in one call.
 *
 * Reconciliation compares every linked invoice a company has, and doing
 * that one GET at a time would be a hundred round trips for a company with
 * a hundred invoices — slow, and a good way to meet Intuit's rate limits
 * on a page someone might refresh twice.
 *
 * Batched because Intuit's query endpoint caps results, and a very long
 * IN list is its own problem: the whole query travels in the URL.
 */
export async function getInvoicesByIds(
  realmId: string,
  accessToken: string,
  qboIds: string[],
): Promise<QuickBooksInvoice[]> {
  const found: QuickBooksInvoice[] = [];
  const BATCH = 50;

  for (let i = 0; i < qboIds.length; i += BATCH) {
    const batch = qboIds.slice(i, i + BATCH);
    // Ids come from our own database, but they are still interpolated into
    // a query language with no parameter binding — so anything that is not
    // a plain id is dropped rather than escaped. QuickBooks ids are
    // numeric strings; nothing legitimate is lost.
    const safe = batch.filter((id) => /^[0-9]+$/.test(id));
    if (safe.length === 0) continue;

    const list = safe.map((id) => `'${id}'`).join(",");
    const query = encodeURIComponent(
      `select Id, DocNumber, TotalAmt, PrivateNote from Invoice where Id in (${list})`,
    );
    const body = await accountingRequest<{
      QueryResponse?: { Invoice?: QuickBooksInvoice[] };
    }>(realmId, accessToken, `/query?query=${query}`);

    found.push(...(body.QueryResponse?.Invoice ?? []));
  }

  return found;
}

/* ------------------------------------------------------------------ */
/* Reading for the onboarding import                                   */
/* ------------------------------------------------------------------ */

/**
 * Reading a contractor's customers, vendors and products/services so a new
 * C Stream company can start from what is already in QuickBooks
 * (apps/web/lib/quickbooks-import.ts plans it, lib/actions/quickbooksImport.ts
 * writes it).
 *
 * READ-ONLY, AND BY CONSTRUCTION RATHER THAN BY PROMISE. Every call below
 * goes through `accountingRequest` with method GET — the query endpoint —
 * and nothing here takes a payload. Nothing in the import path imports a
 * function from the "Writing to QuickBooks" section above; the import's
 * tests fail if an accounting-API request from it is anything but a GET.
 *
 * DATA MINIMISATION AT THE BOUNDARY. `select *` returns whole records, and a
 * Vendor record carries a (masked) tax id and 1099 flags. The raw record is
 * mapped here into a small shape holding only the fields the import uses,
 * so nothing else can leak further in by accident — the tax id never
 * leaves this function.
 *
 * PAGING. Intuit's query language pages with STARTPOSITION (1-based) and
 * MAXRESULTS (at most 1000). A page shorter than asked for is the last
 * one. Ordered by a sortable field (see SORT_FIELD) so paging is stable.
 * MAXRESULTS is always sent: left out, Intuit returns 100 rows, and a page
 * of 100 against an asked-for 1000 would read as the last page.
 * `select * from Customer` leaves inactive (deleted) records out by
 * default, which is what an onboarding import wants.
 */

/** Intuit's own ceiling on MAXRESULTS. */
export const QUICKBOOKS_QUERY_PAGE_MAX = 1000;

export interface QuickBooksAddress {
  line1: string | null;
  line2: string | null;
  line3: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

/** A customer or a vendor, reduced to what the import reads. */
export interface QuickBooksImportParty {
  id: string;
  displayName: string | null;
  companyName: string | null;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  billAddress: QuickBooksAddress | null;
  shipAddress: QuickBooksAddress | null;
  /** Customers only: a sub-customer, which QuickBooks uses for jobs. */
  parentName: string | null;
  isSubCustomer: boolean;
}

export interface QuickBooksImportItem {
  id: string;
  name: string | null;
  fullyQualifiedName: string | null;
  /** Service | Inventory | NonInventory | Group | Category, as Intuit spells it. */
  type: string | null;
  unitPrice: number | null;
  purchaseCost: number | null;
}

export interface QuickBooksReadResult<T> {
  rows: T[];
  /** More records exist past `limit` — the caller says so rather than
   * pretending the account was read in full. */
  truncated: boolean;
}

type RawAddress = {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
};

type RawParty = {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  BillAddr?: RawAddress;
  ShipAddr?: RawAddress;
  Job?: boolean;
  ParentRef?: { value?: string; name?: string };
};

type RawItem = {
  Id: string;
  Name?: string;
  FullyQualifiedName?: string;
  Type?: string;
  UnitPrice?: number;
  PurchaseCost?: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function address(raw: RawAddress | undefined): QuickBooksAddress | null {
  if (!raw) return null;
  const mapped: QuickBooksAddress = {
    line1: text(raw.Line1),
    line2: text(raw.Line2),
    line3: text(raw.Line3),
    city: text(raw.City),
    region: text(raw.CountrySubDivisionCode),
    postalCode: text(raw.PostalCode),
  };
  return Object.values(mapped).some(Boolean) ? mapped : null;
}

function party(raw: RawParty): QuickBooksImportParty {
  return {
    id: String(raw.Id),
    displayName: text(raw.DisplayName),
    companyName: text(raw.CompanyName),
    givenName: text(raw.GivenName),
    familyName: text(raw.FamilyName),
    email: text(raw.PrimaryEmailAddr?.Address),
    phone: text(raw.PrimaryPhone?.FreeFormNumber),
    mobile: text(raw.Mobile?.FreeFormNumber),
    billAddress: address(raw.BillAddr),
    shipAddress: address(raw.ShipAddr),
    parentName: text(raw.ParentRef?.name),
    isSubCustomer: raw.Job === true || Boolean(raw.ParentRef?.value),
  };
}

function item(raw: RawItem): QuickBooksImportItem {
  return {
    id: String(raw.Id),
    name: text(raw.Name),
    fullyQualifiedName: text(raw.FullyQualifiedName),
    type: text(raw.Type),
    unitPrice: money(raw.UnitPrice),
    purchaseCost: money(raw.PurchaseCost),
  };
}

export interface QuickBooksReadOptions {
  /** Records per request; clamped to Intuit's 1000. */
  pageSize?: number;
  /** Most records read in one import. */
  limit?: number;
}

/**
 * What each read is ordered by, so paging is stable while the account is
 * read. Not `Id`: Intuit's entity reference marks Id filterable but NOT
 * sortable, and these three are marked sortable. Display names are unique
 * per list in QuickBooks, so neither order has ties to shuffle.
 */
const SORT_FIELD = { Customer: "DisplayName", Vendor: "DisplayName", Item: "Name" } as const;

/** One entity, every page, up to `limit`. GET only. */
async function readEveryPage<Raw>(
  realmId: string,
  accessToken: string,
  entity: "Customer" | "Vendor" | "Item",
  options: QuickBooksReadOptions,
): Promise<QuickBooksReadResult<Raw>> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? QUICKBOOKS_QUERY_PAGE_MAX, QUICKBOOKS_QUERY_PAGE_MAX));
  const limit = Math.max(1, options.limit ?? 5000);
  const rows: Raw[] = [];

  const page = async (start: number, max: number): Promise<Raw[]> => {
    const query = encodeURIComponent(
      `select * from ${entity} ORDERBY ${SORT_FIELD[entity]} STARTPOSITION ${start} MAXRESULTS ${max}`,
    );
    const body = await accountingRequest<{ QueryResponse?: Record<string, unknown> }>(
      realmId,
      accessToken,
      `/query?query=${query}`,
    );
    const found = body.QueryResponse?.[entity];
    return Array.isArray(found) ? (found as Raw[]) : [];
  };

  for (let start = 1; rows.length < limit; ) {
    const max = Math.min(pageSize, limit - rows.length);
    const got = await page(start, max);
    rows.push(...got);
    if (got.length < max) return { rows, truncated: false };
    start += got.length;
  }
  // Exactly at the limit: one record past it says whether there is more,
  // so an account of exactly `limit` records is not reported as cut short.
  const beyond = await page(limit + 1, 1);
  return { rows, truncated: beyond.length > 0 };
}

export async function readCustomersForImport(
  realmId: string,
  accessToken: string,
  options: QuickBooksReadOptions = {},
): Promise<QuickBooksReadResult<QuickBooksImportParty>> {
  const read = await readEveryPage<RawParty>(realmId, accessToken, "Customer", options);
  return { rows: read.rows.map(party), truncated: read.truncated };
}

export async function readVendorsForImport(
  realmId: string,
  accessToken: string,
  options: QuickBooksReadOptions = {},
): Promise<QuickBooksReadResult<QuickBooksImportParty>> {
  const read = await readEveryPage<RawParty>(realmId, accessToken, "Vendor", options);
  return { rows: read.rows.map(party), truncated: read.truncated };
}

export async function readItemsForImport(
  realmId: string,
  accessToken: string,
  options: QuickBooksReadOptions = {},
): Promise<QuickBooksReadResult<QuickBooksImportItem>> {
  const read = await readEveryPage<RawItem>(realmId, accessToken, "Item", options);
  return { rows: read.rows.map(item), truncated: read.truncated };
}
