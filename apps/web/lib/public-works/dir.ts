/**
 * THE DIR PUBLIC WORKS PORTAL, READ WITHOUT A LOGIN.
 *
 * `services.dir.ca.gov/pw` is a ServiceNow portal. There is no documented
 * bulk download and the Table API answers 401 to a guest — but the portal's
 * own search pages are ordinary ServiceNow data-table widgets, and a widget
 * answers a guest who presents the session it was just handed. Established
 * 2026-10-13 by reading the page's network calls, then reproduced with curl:
 *
 *   1. GET /pw            → a guest JSESSIONID and a `g_ck` token in the HTML
 *   2. POST /api/now/sp/widget/<id>?<page params>, header X-UserToken: g_ck,
 *      JSON body { table, filter, fields, view, o, d, p, window_size }
 *      → { result: { data: { list, row_count, num_pages } } }
 *
 * `window_size` goes to 1000 (about one second a page); dot-walked fields and
 * filters work (`x_cdoi2_csm_portal_project.award_date>=2026-08-01`). The
 * eCPR search is a different widget with its own action and a 6,500-row cap
 * per query, so it is asked by county and date window. Its reCAPTCHA is
 * enforced in the browser only; the server accepts the request without one.
 *
 * Every number and id below is recorded in the memory note
 * `dir-portal-endpoints` and was measured, not inferred. If DIR changes a
 * widget id the sync fails loudly on the first page with the status code.
 */

const ORIGIN = "https://services.dir.ca.gov";
const TABLE_WIDGET = "2f2b08c01b2546103b22c806604bcbec";
const LINKS_WIDGET = "5001b062d7101200b0b044580e6103eb";
const ECPR_WIDGET = "dfeb48e887e7ca14c837eb1e3fbb3570";

export type DirSession = { token: string; cookie: string; fetchImpl: typeof fetch };

export async function openDirSession(fetchImpl: typeof fetch = fetch): Promise<DirSession> {
  const response = await fetchImpl(`${ORIGIN}/pw`, { headers: { "User-Agent": "Mozilla/5.0 (C Stream public-works sync)" } });
  if (!response.ok) throw new Error(`DIR portal answered ${response.status} to /pw`);
  const html = await response.text();
  const token = /g_ck\s*=\s*'([^']+)'/.exec(html)?.[1];
  if (!token) throw new Error("DIR portal page carried no g_ck token; the portal has changed");
  const cookie = setCookieHeaders(response)
    .map((c) => c.split(";")[0])
    .join("; ");
  return { token, cookie, fetchImpl };
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const one = response.headers.get("set-cookie");
  return one ? [one] : [];
}

async function widget<T>(session: DirSession, id: string, pageParams: string, body: unknown): Promise<T> {
  const response = await session.fetchImpl(`${ORIGIN}/api/now/sp/widget/${id}?${pageParams}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UserToken": session.token,
      Cookie: session.cookie,
      "User-Agent": "Mozilla/5.0 (C Stream public-works sync)",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`DIR widget ${id} answered ${response.status}`);
  const json = (await response.json()) as { result?: { data?: T } };
  if (!json.result?.data) throw new Error(`DIR widget ${id} returned no data`);
  return json.result.data;
}

/** A ServiceNow cell: display text plus the raw value (a sys_id for a reference). */
type Cell = { display_value?: string | null; value?: string | null };
type TableData = { list?: Array<Record<string, Cell | string>>; row_count?: number; num_pages?: number };

export type DirRow = { sys_id: string } & Record<string, string>;

/** `{ field: display, field__id: value }` per row — the shape the sync reads. */
export function flattenRow(raw: Record<string, Cell | string>): DirRow {
  const out: Record<string, string> = { sys_id: typeof raw.sys_id === "string" ? raw.sys_id : "" };
  for (const [key, cell] of Object.entries(raw)) {
    if (cell && typeof cell === "object") {
      out[key] = cell.display_value ?? "";
      out[`${key}__id`] = cell.value ?? "";
    }
  }
  return out as DirRow;
}

export type TablePage = { rows: DirRow[]; rowCount: number; numPages: number };

/** One page of the project↔contractor link table. `filter` is ServiceNow
 * encoded-query syntax; the award-date dot-walk is the one the sync uses. */
export async function fetchProjectLinks(session: DirSession, filter: string, page: number, windowSize = 1000): Promise<TablePage> {
  const data = await widget<TableData>(session, LINKS_WIDGET, "id=standard_ticket&table=x_cdoi2_csm_portal_project", {
    table: "x_cdoi2_csm_portal_m2m_x_cdoi2_csm_customer_acc",
    filter,
    fields:
      "customer_account,is_sub_contractor,parent,x_cdoi2_csm_portal_project,x_cdoi2_csm_portal_project.awarding_body,x_cdoi2_csm_portal_project.name,x_cdoi2_csm_portal_project.award_date,x_cdoi2_csm_portal_project.state,x_cdoi2_csm_portal_project.county,sys_created_on",
    view: "portal",
    o: "sys_created_on",
    d: "asc",
    p: page,
    window_size: windowSize,
  });
  return { rows: (data.list ?? []).map(flattenRow), rowCount: data.row_count ?? 0, numPages: data.num_pages ?? 0 };
}

/** One page of the contractor registration list. Kept for the next slice
 * kind (registrations) and for tests of the widget contract; the first
 * version of the sync does not call it. */
export async function fetchRegistrations(session: DirSession, page: number, windowSize = 1000): Promise<TablePage> {
  const filter = "contractor_statusINdir_approved,pending,registration_expired^type=2";
  const data = await widget<TableData>(
    session,
    TABLE_WIDGET,
    `id=dir_contractors&table=x_cdoi2_csm_portal_customer_account_lookup&view=public&sysparm_fixed_query=type%3D2&filter=${encodeURIComponent(filter)}`,
    {
      table: "x_cdoi2_csm_portal_customer_account_lookup",
      filter,
      fields: "pwcr,legal_name,doing_business_as,business_structure,contractor_status,cslb,registration_start_date,registration_end_date",
      view: "public",
      o: "pwcr",
      d: "asc",
      p: page,
      window_size: windowSize,
    },
  );
  return { rows: (data.list ?? []).map(flattenRow), rowCount: data.row_count ?? 0, numPages: data.num_pages ?? 0 };
}

export type EcprRow = {
  IDPAYROLL_TRANSACTION: string;
  START_DATE: string;
  END_DATE: string;
  CONTRACTORNAME: string;
  CONTRACTORPWCR: string;
  PROJECTNAME: string;
  PROJECTID: string;
  AWARDINGBODY: string;
  COUNTY: string;
  SUBMISSIONDATE: string;
  STATEMENTOFNP: string;
  REPORTINGTYPE: string;
};

export type EcprSearch = {
  dateFrom: string;
  dateTo: string;
  county?: string | null;
  contractorName?: string | null;
};

export const ECPR_RESULT_CAP = 6500;

/** The eCPR public search. `capped` means the query hit the 6,500-row
 * ceiling and the caller must split the window, or filings were lost. */
export async function searchEcpr(session: DirSession, search: EcprSearch): Promise<{ rows: EcprRow[]; capped: boolean }> {
  const data = await widget<{ results?: string | { results?: string | EcprRow[] }; gcpResultsLimit?: string | number }>(
    session,
    ECPR_WIDGET,
    "id=ecpr_public_search",
    {
      action: "runSearch",
      searchParams: {
        date_from: search.dateFrom,
        date_to: search.dateTo,
        dir_project_id: null,
        awarding_body_name: null,
        contractor_name: search.contractorName ?? null,
        project_name: null,
        pwcr: null,
        county: search.county ?? null,
      },
    },
  );
  const rows = parseEcprResults(data.results);
  const cap = Number(data.gcpResultsLimit ?? ECPR_RESULT_CAP) || ECPR_RESULT_CAP;
  return { rows, capped: rows.length >= cap };
}

/** DIR returns the result set as JSON inside JSON, sometimes twice over. */
export function parseEcprResults(results: unknown): EcprRow[] {
  let value: unknown = results;
  for (let hops = 0; hops < 3; hops++) {
    if (typeof value === "string") value = JSON.parse(value);
    else if (value && typeof value === "object" && !Array.isArray(value) && "results" in value) value = (value as { results: unknown }).results;
    else break;
  }
  return Array.isArray(value) ? (value as EcprRow[]) : [];
}
