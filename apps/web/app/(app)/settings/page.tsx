import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
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
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { CompanyLicenses } from "@/components/CompanyLicenses";
import { QuickBooksMapping, QuickBooksSyncLog } from "@/components/QuickBooksMapping";
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
  return date ? date.toLocaleDateString() : "—";
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
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-slate-300";
const addButtonClass =
  "inline-flex items-center justify-center rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qb?: string; qb_detail?: string }>;
}) {
  const { company, ...currentUser } = await requireCompanyContext();
  const { qb, qb_detail } = await searchParams;

  if (currentUser.role !== "OWNER") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-xl font-semibold text-slate-100">Settings</h1>
        <p className="text-sm text-slate-400">Only the account owner can manage integrations.</p>
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
      <h1 className="mb-6 text-xl font-semibold text-slate-100">Settings</h1>

      {qb === "connected" && (
        <p className="mb-6 rounded-md border border-green-900 bg-green-950/50 px-4 py-3 text-sm text-green-400">
          QuickBooks connected successfully.
        </p>
      )}
      {qb === "error" && (
        <p className="mb-6 rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {(qb_detail && QB_ERROR_MESSAGES[qb_detail]) ?? "Couldn't connect to QuickBooks — please try again."}
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">QuickBooks Online</h2>
        <p className="mb-4 text-sm text-slate-400">
          Connects your QuickBooks Online company so invoices can be pushed to it. Deliberately
          ONE direction: Prova writes to QuickBooks and reads the record back to confirm what
          landed. It does not pull edits made in QuickBooks back into Prova, and does not
          pretend to — a sync that quietly loses an edit is worse than one that never claimed
          to carry it.
        </p>

        {connection ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="text-sm text-slate-100">
              Connected
              {connection.connectedByUser && ` by ${connection.connectedByUser.name ?? connection.connectedByUser.email}`}
            </p>
            <p className="mb-4 text-xs text-slate-500">
              QuickBooks company ID: {connection.realmId} · connected{" "}
              {connection.createdAt.toLocaleDateString()}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <QuickBooksTestConnectionButton />
              <form action={disconnectQuickBooks}>
                <SubmitButton type="submit" className="text-sm text-red-400 hover:underline">
                  Disconnect
                </SubmitButton>
              </form>
            </div>

            <div className="mt-6 border-t border-slate-800 pt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Chart of accounts
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Nothing is guessed here. An account picked for you is how books get wrong in a way
                nobody notices until tax time.
              </p>
              <QuickBooksMapping mappings={accountMappings} />
            </div>

            <div className="mt-6 border-t border-slate-800 pt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recent sync activity
              </h3>
              <p className="mb-3 text-xs text-slate-500">
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
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Connect QuickBooks
          </a>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Company locations</h2>
        <p className="mb-4 text-sm text-slate-400">
          Offices, yards, and warehouses this company operates out of. Jobs can be tagged with the
          location running them from the job&apos;s Schedule section.
        </p>

        {locations.length > 0 && (
          <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {locations.map((location) => (
              <li key={location.id} className="flex items-start justify-between gap-4 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {location.name ?? labelFor(LOCATION_TYPE_OPTIONS, location.locationType)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {labelFor(LOCATION_TYPE_OPTIONS, location.locationType)} · {location.addressLine1}
                    {location.addressLine2 ? `, ${location.addressLine2}` : ""}, {location.city},{" "}
                    {location.state} {location.zip}
                  </p>
                  {(location.primaryContactName || location.primaryContactPhone) && (
                    <p className="text-xs text-slate-500">
                      {[location.primaryContactName, location.primaryContactPhone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <ConfirmDeleteButton action={deleteCompanyLocation.bind(null, location.id)} />
              </li>
            ))}
          </ul>
        )}

        <details className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">Add a location</summary>
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
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Contractor licences</h2>
        <p className="mb-4 text-sm text-slate-400">
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
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Insurance policies</h2>
        <p className="mb-4 text-sm text-slate-400">
          This company&apos;s own coverage — the source data per-job certificates of insurance would
          eventually be generated from.
        </p>

        {insurancePolicies.length > 0 && (
          <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {insurancePolicies.map((policy) => {
              const status = dateStatus(policy.expirationDate, "INSURANCE_POLICY");
              return (
                <li key={policy.id} className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {labelFor(INSURANCE_POLICY_TYPE_OPTIONS, policy.policyType)} · {policy.carrier}
                    </p>
                    <p className="text-xs text-slate-500">
                      Policy #{policy.policyNumber}
                      {policy.coverageLimits && ` · ${policy.coverageLimits}`}
                    </p>
                    <p className="text-xs text-slate-500">
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

        <details className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">Add a policy</summary>
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
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Bonding</h2>
        <p className="mb-4 text-sm text-slate-400">
          License bonds and overall performance/payment bonding capacity, and who to contact to
          increase it or pull a bond for a specific job.
        </p>

        {bonds.length > 0 && (
          <ul className="mb-4 divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
            {bonds.map((bond) => {
              const status = dateStatus(bond.renewalDate, "BOND");
              return (
                <li key={bond.id} className="flex items-start justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {labelFor(BOND_TYPE_OPTIONS, bond.bondType)} · {bond.suretyName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {bond.aggregateBondingCapacity != null &&
                        `Aggregate ${money(Number(bond.aggregateBondingCapacity))}`}
                      {bond.singleJobLimit != null &&
                        ` · Single job ${money(Number(bond.singleJobLimit))}`}
                    </p>
                    {(bond.agentContactName || bond.agentContactPhone || bond.agentContactEmail) && (
                      <p className="text-xs text-slate-500">
                        {[bond.agentContactName, bond.agentContactPhone, bond.agentContactEmail]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                    <p className="text-xs text-slate-500">
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

        <details className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-300">Add a bond</summary>
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
