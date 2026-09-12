import Link from "next/link";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import {
  createBond,
  createCompanyLocation,
  createInsurancePolicy,
  deleteBond,
  deleteCompanyLocation,
  deleteInsurancePolicy,
  disconnectQuickBooks,
} from "@/lib/actions";
import { QuickBooksTestConnectionButton } from "@/components/QuickBooksTestConnectionButton";
import { money } from "@/lib/money";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { viewerTimeZone } from "@/lib/viewerToday";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { CompanyLicenses } from "@/components/CompanyLicenses";
import { CompanyProfileForm } from "@/components/CompanyProfileForm";
import { companyProfileGaps, type CompanyProfile } from "@/lib/company-profile";
import { QuickBooksMapping, QuickBooksSyncLog } from "@/components/QuickBooksMapping";
import { QuickBooksReconcile } from "@/components/QuickBooksReconcile";
import {
  classifyRenewal,
  renewalTiming,
  toIsoDate,
  type RenewalKind,
} from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";

const QB_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You declined the QuickBooks connection request.",
  state_mismatch: "That connection attempt couldn't be verified — please try again.",
  missing_params: "QuickBooks didn't return the expected information — please try again.",
  token_exchange_failed: "QuickBooks rejected the connection — please try again.",
  // The two the callback added when it stopped trusting its own cookie for
  // identity. Both need their own wording: the fallback below says "please
  // try again", and retrying is precisely what will not help here.
  not_owner: "Only an owner can connect QuickBooks. Ask an owner on your team to do it.",
  identity_mismatch:
    "That connection attempt finished as a different account than it started as. Sign in as the account you want to connect, then start again.",
};

const INSURANCE_POLICY_TYPE_OPTIONS = [
  { value: "GENERAL_LIABILITY", label: "General liability" },
  { value: "WORKERS_COMP", label: "Workers' comp" },
  { value: "AUTO", label: "Auto" },
  { value: "UMBRELLA_EXCESS", label: "Umbrella / excess" },
] as const;

const BOND_TYPE_OPTIONS = [
  { value: "LICENSE_BOND", label: "License bond" },
  { value: "PERFORMANCE_PAYMENT_CAPACITY", label: "Performance/payment capacity" },
] as const;

const LOCATION_TYPE_OPTIONS = [
  { value: "HQ", label: "HQ" },
  { value: "BRANCH_YARD", label: "Branch yard" },
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "TRAILER", label: "Trailer" },
] as const;

function labelFor(options: readonly { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label ?? value;
}

function formatDate(date: Date | null) {
  return date ? formatCalendarDate(date, "numeric") : "—";
}

/**
 * Expired/upcoming status, computed at read time and worded by the same
 * function the renewals panel uses.
 *
 * It used to do its own arithmetic: floor((date - Date.now()) / a day).
 * That compares a date stored at UTC midnight against the current instant,
 * so from mid-morning onward it lost a day — a policy expiring in twelve
 * days read "Expires in 11d" here while /compliance correctly said "due in
 * 12 days". Browser testing caught both numbers on screen for one record.
 * Two answers for the same fact is worse than either being wrong, because
 * now neither can be trusted.
 *
 * It also warned at a flat 60 days for both policies and bonds, which
 * disagreed with the per-kind horizons the renewals panel ranks by.
 */
function dateStatus(date: Date | null, kind: RenewalKind) {
  if (!date) return null;
  const renewal = classifyRenewal(
    {
      id: "",
      kind,
      title: "",
      detail: null,
      date: toIsoDate(date),
      expectsDate: true,
      href: "",
    },
    serverToday(),
  );
  if (renewal.urgency === "EXPIRED") return { text: "Expired", className: "text-red-400" };
  if (renewal.urgency === "DUE_SOON") {
    return { text: renewalTiming(renewal), className: "text-amber-400" };
  }
  return null;
}

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";
const addButtonClass =
  "inline-flex items-center justify-center rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-ink hover:bg-neutral-700";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qb?: string; qb_detail?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;
  const { qb, qb_detail } = await searchParams;
  // The QuickBooks "connected <date>" line below is a real moment, not a
  // calendar day, so it is read on the reader's calendar rather than UTC.
  const timeZone = await viewerTimeZone();

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-ink-body">Only the account owner can manage integrations.</p>
      </div>
    );
  }

  const [connection, locations, insurancePolicies, bonds, licences, accountMappings, rawSyncAttempts, classifications] = await Promise.all([
    prisma.quickBooksConnection.findUnique({
      where: { companyId: company.id },
      include: { connectedByUser: true },
    }),
    prisma.companyLocation.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.companyInsurancePolicy.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.companyBond.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.companyLicense.findMany({
      where: { companyId: company.id },
      orderBy: [{ jurisdictionName: "asc" }, { licenseNumber: "asc" }],
    }),
    // A global lookup, not scoped to a company. Empty today — deliberately
    // seeded only for jurisdictions with a real, verified code list, since
    // the schema is explicit that a wrong code here is worse than none. The
    // form falls back to free text, which is correct for Colorado anyway.
    prisma.quickBooksAccountMapping.findMany({
      where: { companyId: company.id },
      select: { purpose: true, qboAccountId: true, qboAccountName: true },
    }),
    // Only the recent tail: this is a "what just happened" surface, not an
    // audit archive, and the table grows one row per push forever.
    prisma.quickBooksSyncAttempt.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    prisma.licenseClassificationReference.findMany({
      orderBy: [{ jurisdictionName: "asc" }, { code: "asc" }],
      select: { jurisdictionName: true, code: true, label: true },
    }),
  ]);

  // Picked field by field rather than spread: this crosses into a client
  // component, and the row also carries `isProvaOperator` and the timestamps,
  // none of which this form has any business seeing.
  const companyProfile: CompanyProfile = {
    name: company.name,
    dbaName: company.dbaName,
    ein: company.ein,
    hqAddressLine1: company.hqAddressLine1,
    hqAddressLine2: company.hqAddressLine2,
    hqCity: company.hqCity,
    hqState: company.hqState,
    hqZip: company.hqZip,
    phone: company.phone,
    website: company.website,
  };

  const syncAttempts = rawSyncAttempts.map((attempt) => ({
    id: attempt.id,
    entityType: attempt.entityType,
    outcome: attempt.outcome,
    summary: attempt.summary,
    detail: attempt.detail,
    // Rendered in UTC like every other date in this app, and as a string
    // so the server and client can't disagree about the format.
    createdAt: `${attempt.createdAt.toISOString().slice(0, 10)} ${attempt.createdAt
      .toISOString()
      .slice(11, 16)} UTC`,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Settings</h1>

      {/* The Integrations page is the framework's own surface; QuickBooks
          keeps its section below because it predates that framework and has
          an account mapping and reconciliation the generic page has no place
          for. The link exists so there is one route to look for connections
          from, rather than two pages neither of which mentions the other. */}
      <p className="mb-6 text-sm text-ink-body">
        <Link href="/settings/integrations" className="text-link hover:text-link-hover">
          Integrations
        </Link>{" "}
        — connect and disconnect third-party services.
      </p>

      {/* Every card the Ask box has ever put in front of somebody, with
          what became of it. Owner-only, like this page's integrations. */}
      <p className="mb-6 text-sm text-ink-body">
        <Link href="/settings/assistant" className="text-link hover:text-link-hover">
          Assistant
        </Link>{" "}
        — what the Ask box has proposed, and what became of it.
      </p>

      {/* Findable without asking anyone, which is most of the point: the
          research found four vendors where getting your history out meant a
          support ticket, a sales call, or nothing at all. */}
      <p className="mb-6 text-sm text-ink-body">
        <Link href="/settings/export" className="text-link hover:text-link-hover">
          Export your data
        </Link>{" "}
        — every job, price, cost and hour, as CSV or one JSON file.
      </p>

      {qb === "connected" && (
        <p className="mb-6 rounded-md border border-green-700 bg-tag-green px-4 py-3 text-sm text-green-400">
          QuickBooks connected successfully.
        </p>
      )}
      {qb === "error" && (
        <p className="mb-6 rounded-md border border-red-700 bg-tag-rose px-4 py-3 text-sm text-red-400">
          {(qb_detail && QB_ERROR_MESSAGES[qb_detail]) ?? "Couldn't connect to QuickBooks — please try again."}
        </p>
      )}

      {/* FIRST section on the page, and the heading is exactly "Company"
          because four places in the codebase tell a reader to go to
          "Settings → Company" — two of them in red on a document a trust
          fund receives. `companyPointer.test.ts` fails the build if that
          instruction and this heading ever stop agreeing. */}
      <section id="company" className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Company</h2>
        <p className="mb-4 text-sm text-ink-body">
          Your own company record. This is where the WH-347 certified payroll form, a union
          trust-fund remittance report, the signature block a GC signs and the sidebar all get the
          company name and address from — so a blank here is a blank on a document somebody outside
          this company reads.
        </p>
        <CompanyProfileForm company={companyProfile} gaps={companyProfileGaps(companyProfile)} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">QuickBooks Online</h2>
        <p className="mb-4 text-sm text-ink-body">
          Connects your QuickBooks Online company so invoices can be pushed to it. Deliberately
          ONE direction: C Stream writes to QuickBooks and reads the record back to confirm what
          landed. It does not pull edits made in QuickBooks back into C Stream, and does not
          pretend to — a sync that quietly loses an edit is worse than one that never claimed
          to carry it.
        </p>

        {connection ? (
          <div className="rounded-lg border border-line-card bg-surface p-4">
            <p className="text-sm text-ink">
              Connected
              {connection.connectedByUser && ` by ${connection.connectedByUser.name ?? connection.connectedByUser.email}`}
            </p>
            <p className="mb-4 text-xs text-ink-muted">
              QuickBooks company ID: {connection.realmId} · connected{" "}
              {formatInstant(connection.createdAt, timeZone, "numeric")}
            </p>
            {/* Found by the destructive-form census in
                `rowActionsCensus.test.ts`, not by a person: Disconnect was a
                bare one-click form sitting next to a live "Test connection",
                and getting the two confused ends the connection. Reconnecting
                is an OAuth round trip through Intuit, and the redirect URI has
                to still be right for it to come back (CLAUDE.md), so this is
                not a click to spend by accident. The account mapping does
                survive, which is why the hint says so.
                Left-aligned cluster, so the FIRST slot is the stable one and
                Cancel goes first — `pinned` stays at its default "start". */}
            <RowActions
              className="flex flex-wrap items-center gap-3"
              destructive={
                <ConfirmDelete
                  action={disconnectQuickBooks}
                  label="Disconnect"
                  confirmLabel="Confirm disconnect"
                  deleteClassName="text-sm text-red-400 hover:underline"
                  hint={
                    <span className="max-w-[20rem] text-ink-muted">
                      Reconnecting is a fresh sign-in through Intuit. Your account mapping is kept.
                    </span>
                  }
                />
              }
            >
              <QuickBooksTestConnectionButton />
            </RowActions>

            <div className="mt-6 border-t border-line-row pt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-body">
                Chart of accounts
              </h3>
              <p className="mb-3 text-xs text-ink-muted">
                Nothing is guessed here. An account picked for you is how books get wrong in a way
                nobody notices until tax time.
              </p>
              <QuickBooksMapping mappings={accountMappings} />
            </div>

            <div className="mt-6 border-t border-line-row pt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-body">
                Does QuickBooks still agree?
              </h3>
              <p className="mb-3 text-xs text-ink-muted">
                This sync only writes to QuickBooks — an edit made there is refused rather than
                absorbed, and nothing here changes until you ask. This is how you find out that
                someone changed an invoice on the other side.
              </p>
              <QuickBooksReconcile />
            </div>

            <div className="mt-6 border-t border-line-row pt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-body">
                Recent sync activity
              </h3>
              <p className="mb-3 text-xs text-ink-muted">
                Every attempt, including refusals and anything that landed differently from what
                was sent.
              </p>
              <QuickBooksSyncLog attempts={syncAttempts} />
            </div>
          </div>
        ) : (
          // A plain link (not next/link, so it's never hover-prefetched, and
          // not a Server Action form — see app/api/quickbooks/start/route.ts
          // for why this needs to be a real GET navigation).
          <a
            href="/api/quickbooks/start"
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
          >
            Connect QuickBooks
          </a>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Company locations</h2>
        <p className="mb-4 text-sm text-ink-body">
          Offices, yards, and warehouses this company operates out of. Jobs can be tagged with the
          location running them from the job&apos;s Schedule section.
        </p>

        {/* Without this the whole section was a heading and a closed
            triangle: the list is hidden when empty and the form is inside
            `<details>`, so a new account saw no text at all. Worded like
            the Licences section, which was the only one of the four that
            said anything. */}
        {locations.length === 0 && (
          <p className="mb-4 text-sm text-ink-body">
            No locations recorded. Add the office or yard you run work out of and a job can be tagged
            with the one running it.
          </p>
        )}

        {locations.length > 0 && (
          <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {locations.map((location) => (
              <li key={location.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {location.name ?? labelFor(LOCATION_TYPE_OPTIONS, location.locationType)}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {labelFor(LOCATION_TYPE_OPTIONS, location.locationType)} · {location.addressLine1}
                    {location.addressLine2 ? `, ${location.addressLine2}` : ""}, {location.city},{" "}
                    {location.state} {location.zip}
                  </p>
                  {(location.primaryContactName || location.primaryContactPhone) && (
                    <p className="text-xs text-ink-muted">
                      {[location.primaryContactName, location.primaryContactPhone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <ConfirmDeleteButton action={deleteCompanyLocation.bind(null, location.id)} />
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg border border-line-card bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-label">Add a location</summary>
          <form action={createCompanyLocation} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Type
                <select name="locationType" defaultValue="BRANCH_YARD" className={inputClass}>
                  {LOCATION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Name (optional)
                <input name="name" placeholder="Denver Yard" className={`w-48 ${inputClass}`} />
              </label>
            </div>
            <label className={labelClass}>
              Address line 1
              <input name="addressLine1" required className={inputClass} />
            </label>
            <label className={labelClass}>
              Address line 2 (optional)
              <input name="addressLine2" className={inputClass} />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                City
                <input name="city" required className={`w-48 ${inputClass}`} />
              </label>
              <label className={labelClass}>
                State
                <input name="state" required maxLength={2} placeholder="CO" className={`w-20 ${inputClass}`} />
              </label>
              <label className={labelClass}>
                Zip
                <input name="zip" required className={`w-28 ${inputClass}`} />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Contact name (optional)
                <input name="primaryContactName" className={inputClass} />
              </label>
              <label className={labelClass}>
                Contact phone (optional)
                <input name="primaryContactPhone" className={inputClass} />
              </label>
            </div>
            <SubmitButton type="submit" className={`self-start ${addButtonClass}`}>
              Add location
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Contractor licences</h2>
        <p className="mb-4 text-sm text-ink-body">
          One row per licence you hold, not per state — some jurisdictions have no state licence at
          all, only municipal ones, so working in two Colorado cities means two rows here. These feed
          the renewals list on Compliance.
        </p>
        <CompanyLicenses
          licences={licences.map((licence) => ({
            id: licence.id,
            jurisdictionType: licence.jurisdictionType,
            jurisdictionName: licence.jurisdictionName,
            classificationCode: licence.classificationCode,
            classificationLabel: licence.classificationLabel,
            licenseNumber: licence.licenseNumber,
            issueDate: toIsoDate(licence.issueDate),
            expirationDate: toIsoDate(licence.expirationDate),
            status: licence.status,
            bondNumber: licence.bondNumber,
          }))}
          classifications={classifications}
          // Passed down rather than computed in the browser: the client
          // deciding what day it is would disagree with this render.
          today={serverToday()}
          canManage={currentUser.role === "OWNER"}
        />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Insurance policies</h2>
        <p className="mb-4 text-sm text-ink-body">
          This company&apos;s own coverage — the source data per-job certificates of insurance would
          eventually be generated from.
        </p>

        {insurancePolicies.length === 0 && (
          <p className="mb-4 text-sm text-ink-body">
            No policies recorded. Add your general liability, workers&apos; comp and auto cover and
            they&apos;ll appear in the renewals list on{" "}
            <span className="text-ink-label">Compliance</span> before any of them lapse — cover that
            expired last week is what stops a crew at the gate.
          </p>
        )}

        {insurancePolicies.length > 0 && (
          <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {insurancePolicies.map((policy) => {
              const status = dateStatus(policy.expirationDate, "INSURANCE_POLICY");
              return (
                <li key={policy.id} className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {labelFor(INSURANCE_POLICY_TYPE_OPTIONS, policy.policyType)} · {policy.carrier}
                    </p>
                    <p className="text-xs text-ink-muted">
                      Policy #{policy.policyNumber}
                      {policy.coverageLimits && ` · ${policy.coverageLimits}`}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {formatDate(policy.effectiveDate)} – {formatDate(policy.expirationDate)}
                      {status && <span className={`ml-2 ${status.className}`}>{status.text}</span>}
                    </p>
                  </div>
                  <ConfirmDeleteButton action={deleteInsurancePolicy.bind(null, policy.id)} />
                </li>
              );
            })}
          </ul>
        )}

        <details className="rounded-lg border border-line-card bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-label">Add a policy</summary>
          <form action={createInsurancePolicy} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Type
                <select name="policyType" defaultValue="GENERAL_LIABILITY" className={inputClass}>
                  {INSURANCE_POLICY_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Carrier
                <input name="carrier" required className={inputClass} />
              </label>
              <label className={labelClass}>
                Policy number
                <input name="policyNumber" required className={inputClass} />
              </label>
            </div>
            <label className={labelClass}>
              Coverage limits (optional)
              <input
                name="coverageLimits"
                placeholder="$1M per occurrence / $2M aggregate"
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Effective date
                <input type="date" name="effectiveDate" className={inputClass} />
              </label>
              <label className={labelClass}>
                Expiration date
                <input type="date" name="expirationDate" className={inputClass} />
              </label>
            </div>
            <SubmitButton type="submit" className={`self-start ${addButtonClass}`}>
              Add policy
            </SubmitButton>
          </form>
        </details>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Bonding</h2>
        <p className="mb-4 text-sm text-ink-body">
          License bonds and overall performance/payment bonding capacity, and who to contact to
          increase it or pull a bond for a specific job.
        </p>

        {bonds.length === 0 && (
          <p className="mb-4 text-sm text-ink-body">
            No bonding recorded. Add a licence bond or your total performance and payment capacity and
            its renewal date joins the list on <span className="text-ink-label">Compliance</span> —
            and the contact saved with it is who to ring when a GC wants a bond on a specific job.
          </p>
        )}

        {bonds.length > 0 && (
          <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
            {bonds.map((bond) => {
              const status = dateStatus(bond.renewalDate, "BOND");
              return (
                <li key={bond.id} className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {labelFor(BOND_TYPE_OPTIONS, bond.bondType)} · {bond.suretyName}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {bond.aggregateBondingCapacity != null &&
                        `Aggregate ${money(Number(bond.aggregateBondingCapacity))}`}
                      {bond.singleJobLimit != null &&
                        ` · Single job ${money(Number(bond.singleJobLimit))}`}
                    </p>
                    {(bond.agentContactName || bond.agentContactPhone || bond.agentContactEmail) && (
                      <p className="text-xs text-ink-muted">
                        {[bond.agentContactName, bond.agentContactPhone, bond.agentContactEmail]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <p className="text-xs text-ink-muted">
                      Renewal: {formatDate(bond.renewalDate)}
                      {status && <span className={`ml-2 ${status.className}`}>{status.text}</span>}
                    </p>
                  </div>
                  <ConfirmDeleteButton action={deleteBond.bind(null, bond.id)} />
                </li>
              );
            })}
          </ul>
        )}

        <details className="rounded-lg border border-line-card bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink-label">Add a bond</summary>
          <form action={createBond} className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Type
                <select name="bondType" defaultValue="LICENSE_BOND" className={inputClass}>
                  {BOND_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Surety
                <input name="suretyName" required className={inputClass} />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Aggregate bonding capacity (optional)
                <input name="aggregateBondingCapacity" type="number" step="0.01" className={`w-48 ${inputClass}`} />
              </label>
              <label className={labelClass}>
                Single job limit (optional)
                <input name="singleJobLimit" type="number" step="0.01" className={`w-48 ${inputClass}`} />
              </label>
              <label className={labelClass}>
                Renewal date (optional)
                <input type="date" name="renewalDate" className={inputClass} />
              </label>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className={labelClass}>
                Agent name (optional)
                <input name="agentContactName" className={inputClass} />
              </label>
              <label className={labelClass}>
                Agent phone (optional)
                <input name="agentContactPhone" className={inputClass} />
              </label>
              <label className={labelClass}>
                Agent email (optional)
                <input name="agentContactEmail" type="email" className={inputClass} />
              </label>
            </div>
            <SubmitButton type="submit" className={`self-start ${addButtonClass}`}>
              Add bond
            </SubmitButton>
          </form>
        </details>
      </section>
    </div>
  );
}
