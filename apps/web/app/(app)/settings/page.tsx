import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { prisma } from "@prova/db";
import { PageShell } from "@prova/ui";
import { requireCapability } from "@/lib/authz";
import { bidDefaultsView } from "@/lib/estimating/bid-defaults-view";
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
import { PhaseCodes } from "@/components/PhaseCodes";
import { EmployerBurdenRates } from "@/components/EmployerBurdenRates";
import { employerBurdenStanding } from "@/lib/employer-burden";
import { loadEmployerBurdenRates } from "@/lib/employer-burden-query";
import { BidDefaultsForm } from "@/components/BidDefaultsForm";
import { CompanyProfileForm } from "@/components/CompanyProfileForm";
import { companyProfileGaps, type CompanyProfile } from "@/lib/company-profile";
import { BusinessScopeSettingsForm } from "@/components/BusinessScopeSettingsForm";
import { OpeningDeductionForm } from "@/components/OpeningDeductionForm";
import { RoomFinderSwitch } from "@/components/RoomFinderSwitch";
import { DemotedWallsSwitch } from "@/components/DemotedWallsSwitch";
import type { BusinessScopeAnswers } from "@/lib/businessScope";
import { QuickBooksMapping, QuickBooksSyncLog } from "@/components/QuickBooksMapping";
import { QuickBooksReconcile } from "@/components/QuickBooksReconcile";
import { QuickBooksImport } from "@/components/QuickBooksImport";
import {
  classifyRenewal,
  renewalTiming,
  toIsoDate,
  type RenewalKind,
} from "@/lib/compliance-expiry";
import { serverToday } from "@/lib/serverToday";
import { quickBooksConnectCardState, quickBooksSetup } from "@/lib/quickbooks-setup";
import { ActionForm } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { PageTabs } from "@/components/PageTabs";
import { activeTab } from "@/components/pageTabsActive";

export const metadata = { title: "Settings" };

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
  // /api/quickbooks/start refuses before leaving the app when this install
  // has no client id/secret/redirect URI — see lib/quickbooks-setup.ts.
  // Reachable only by typing the URL directly, since the button itself is
  // gated below; kept as a named message rather than falling through to
  // "please try again", which would be false — retrying changes nothing
  // here without someone adding the missing keys.
  not_configured: "QuickBooks isn't set up on this install yet.",
};

const INSURANCE_POLICY_TYPE_OPTIONS = [
  { value: "GENERAL_LIABILITY", label: "General liability" },
  { value: "WORKERS_COMP", label: "Workers' comp" },
  { value: "AUTO", label: "Auto" },
  { value: "UMBRELLA_EXCESS", label: "Umbrella / excess" },
] as const;

const BOND_TYPE_OPTIONS = [
  // "Licence" is this app's rendered voice everywhere else on this page
  // (Contractor licences, licence bond) — the enum stays LICENSE_BOND.
  { value: "LICENSE_BOND", label: "Licence bond" },
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
  if (renewal.urgency === "EXPIRED") return { text: "Expired", className: "text-danger" };
  if (renewal.urgency === "DUE_SOON") {
    return { text: renewalTiming(renewal), className: "text-warn" };
  }
  return null;
}

/**
 * The page's five groups, one rendered at a time (density audit #2: fifteen
 * sections, seven forms and 7.1 screens on one scroll). `?tab=` on this one
 * page rather than sub-routes: `/settings/integrations`, `/import`, `/export`
 * and `/assistant` are already real child pages, and a tab must not collide
 * with them. The bare href is Company, so every old `/settings` link —
 * "Settings → Company" on the WH-347 included — still lands on the right
 * group. A link to a section in another group carries its tab:
 * `/settings?tab=licences#insurance`. A hash alone cannot pick the tab — the
 * server never sees it.
 */
const SETTINGS_TABS = [
  { key: "company", href: "/settings", label: "Company" },
  { key: "estimating", href: "/settings?tab=estimating", label: "Estimating defaults" },
  { key: "quickbooks", href: "/settings?tab=quickbooks", label: "QuickBooks" },
  { key: "licences", href: "/settings?tab=licences", label: "Insurance, bonding & licences" },
  { key: "appearance", href: "/settings?tab=appearance", label: "Appearance" },
] as const;

const moreLinkClass = "inline-flex min-h-11 items-center text-link hover:text-link-hover mouse:min-h-0";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none";
const labelClass = "flex flex-col gap-1 text-sm text-ink-label";
const addButtonClass =
  "inline-flex items-center justify-center rounded-md bg-rail-hover px-4 py-2 text-sm font-medium text-ink hover:bg-lift";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ qb?: string; qb_detail?: string; tab?: string }>;
}) {
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company, ...currentUser } = context;
  const switches = await prisma.company.findUnique({
    where: { id: company.id },
    select: { roomFinderOn: true, demotedWallsOn: true },
  });
  const roomFinderOn = switches?.roomFinderOn ?? false;
  const demotedWallsOn = switches?.demotedWallsOn ?? false;
  const { qb, qb_detail, tab: tabParam } = await searchParams;
  // The same rule PageTabs highlights by, so the tab lit is the group shown.
  const tab =
    activeTab(SETTINGS_TABS, "/settings", new URLSearchParams(tabParam ? { tab: tabParam } : {}))?.key ??
    "company";
  // The QuickBooks "connected <date>" line below is a real moment, not a
  // calendar day, so it is read on the reader's calendar rather than UTC.
  const timeZone = await viewerTimeZone();

  if (currentUser.role !== "OWNER") {
    return (
      <PageShell width="reading">
        <PageHeader route="/settings" title="Settings" />
        {/* NAMES WHAT IS BEHIND THE DOOR. It said "Only the account owner
            can manage integrations", which describes ONE of this page's ten
            sections — the rest are the company profile that prints on the
            WH-347, contractor licences, insurance policies, bonds, company
            locations, employer burden rates, phase codes and default markup.

            That mattered to one role in particular: `RENEWAL` alerts are
            gated on MANAGE_COMPLIANCE, and `lib/renewals.ts` sends licence,
            policy and bond expiries here. So a compliance member is shown
            "Licence 8821 — expires in 9 days" and lands on a sentence about
            integrations, which reads as the wrong page rather than the right
            page they lack access to.

            The page still refuses, and widening it is a permissions decision
            nobody has made. This only stops the refusal being misleading
            while that decision is pending. */}
        <p className="text-sm text-ink-body" data-tour="settings-owner-only">
          Only the account owner can open Settings. Licences, insurance,
          bonds, the company profile, burden rates and the QuickBooks
          connection all live here — ask them to make the change, or to give
          you owner access.
        </p>
      </PageShell>
    );
  }

  const [connection, locations, insurancePolicies, bonds, licences, accountMappings, rawSyncAttempts, classifications, phaseCodes, employerBurdenRates, bidDefaultsRow] = await Promise.all([
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
    // Phase codes, in the company's own reading order — which is neither
    // alphabetical nor code order, hence sortOrder first. The line count
    // comes back with them so the Retire button can say what it is about
    // to leave behind rather than the reader having to guess.
    prisma.phaseCode.findMany({
      where: { companyId: company.id },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: { _count: { select: { lineItems: true } } },
    }),
    // The employer-burden percentages. Which one is IN FORCE is derived from
    // the dates below, never stored — see lib/employer-burden.ts.
    loadEmployerBurdenRates(company.id),
    prisma.companyBidDefaults.findUnique({ where: { companyId: company.id } }),
  ]);

  // Decimal columns crossing into a client component: strings, so the form
  // shows exactly what is stored and no float rounding happens on the way.
  const bidDefaults = bidDefaultsView(bidDefaultsRow);

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

  // Picked field by field for the same reason companyProfile above is —
  // this crosses into a client component and has no business carrying
  // `isProvaOperator` or the timestamps with it.
  const businessScope: BusinessScopeAnswers = {
    contractingRelationship: company.contractingRelationship,
    doesPublicWork: company.doesPublicWork,
    filesMonthlyPayApps: company.filesMonthlyPayApps,
    // Carried so the form renders the CURRENT answer. Without it the question
    // saves and then shows blank on the next load, which reads as a broken
    // setting — this app's own "written and never called" shape, wearing a
    // radio group.
    openingDeduction: company.openingDeduction,
    // Decimal -> number at the boundary, because this crosses into a client
    // component and a Prisma Decimal is not serialisable as one.
    openingDeductionSqFt:
      company.openingDeductionSqFt == null ? null : Number(company.openingDeductionSqFt),
  };

  // Whether THIS install has QuickBooks' own client id/secret/redirect URI
  // — never a hardcoded "QuickBooks is live" claim, which is exactly the
  // kind of thing that rots the day someone sets or removes a key and
  // nobody edits a list. Read once, straight from process.env, and only
  // ever exposed downstream as a boolean/card-state — see
  // lib/quickbooks-setup.ts for why no variable's value can reach here.
  const quickBooksCardState = quickBooksConnectCardState(
    quickBooksSetup(process.env).configured,
    connection !== null,
  );

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
    // `reading`, and the width deliberately does not change: this page is
    // eight stacked forms — company details, licences, insurance policies,
    // bonding — and a text input stretched to 1272px is HARDER to read, not
    // easier. Line length is why the cap was here in the first place. What
    // changes is that the page no longer owns the number: the measure is the
    // shell's, so when the type scale moves, this moves with it.
    //
    // The 4.7 screens of vertical scroll this comment used to defer are now
    // tabs: one group rendered per visit, see SETTINGS_TABS.
    <PageShell width="reading">
      <PageHeader route="/settings" title="Settings" />

      {/* The four child pages, as one short row. They were four prose
          paragraphs — nav dressed as text, a full screen-third before the
          first field. Each target page explains itself.
          - Integrations is the framework's own surface; QuickBooks keeps its
            tab here because it predates that framework and has an account
            mapping and reconciliation the generic page has no place for.
          - Assistant: every card the Ask box has put in front of somebody.
          - Export is findable without asking anyone, which is most of the
            point: four vendors in the research made getting your history out
            a support ticket or a sales call.
          - Import, the way in, beside the way out. */}
      <nav aria-label="More settings" className="mb-4 flex flex-wrap gap-x-5 text-sm">
        <Link href="/settings/integrations" className={moreLinkClass} data-tour="settings-integrations">
          Integrations
        </Link>
        <Link href="/settings/assistant" className={moreLinkClass}>
          Assistant
        </Link>
        <Link href="/settings/export" className={moreLinkClass} data-tour="settings-export">
          Export core records
        </Link>
        <Link href="/settings/import" className={moreLinkClass} data-tour="settings-import">
          Import from a spreadsheet
        </Link>
      </nav>

      <PageTabs tabs={SETTINGS_TABS} label="Settings sections" />

      {qb === "connected" && (
        <p className="mb-6 rounded-md border border-green-700 bg-tag-green px-4 py-3 text-sm text-ok">
          QuickBooks connected successfully.
        </p>
      )}
      {qb === "error" && (
        <p className="mb-6 rounded-md border border-red-700 bg-tag-rose px-4 py-3 text-sm text-danger">
          {(qb_detail && QB_ERROR_MESSAGES[qb_detail]) ?? "Couldn't connect to QuickBooks — please try again."}
        </p>
      )}

      {tab === "company" && (
        <>
          {/* Each group's explainers, once, closed — the sections below
              lead with their heading and their form. */}
          <Disclosure summary="How this works" className="mb-8">
            <div className="flex flex-col gap-3 text-sm text-ink-body">
              <p>
                <span className="font-medium text-ink-label">Company</span> is your own company
                record. This is where the WH-347 certified payroll form, a union trust-fund
                remittance report, the signature block a GC signs and the sidebar all get the
                company name and address from — so a blank here is a blank on a document somebody
                outside this company reads.
              </p>
              <p>
                <span className="font-medium text-ink-label">Set up for your work:</span> not every
                menu applies to every business. Your answers tailor which ones the sidebar shows you —
                nothing is removed for good: every page stays reachable by search, by Ask and by its
                own link, and you can change your answers any time.
              </p>
              <p>
                <span className="font-medium text-ink-label">Company locations</span> are the
                offices, yards and warehouses this company operates out of. Jobs can be tagged with
                the location running them from the job&apos;s Schedule section.
              </p>
            </div>
          </Disclosure>
          {/* FIRST section on the page, and the heading is exactly "Company"
              because four places in the codebase tell a reader to go to
              "Settings → Company" — two of them in red on a document a trust
              fund receives. `companyPointer.test.ts` fails the build if that
              instruction and this heading ever stop agreeing. */}
          <section id="company" className="mb-10" data-tour="settings-company">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Company</h2>
            <CompanyProfileForm company={companyProfile} gaps={companyProfileGaps(companyProfile)} />
          </section>

          {/* What your business needs on screen — the three onboarding
              questions, answered once at signup (or skipped) and changeable
              here at any time. See lib/businessScope.ts: this only changes
              what the rail shows, never what a direct link, a search or Ask
              can reach.

              THE COPY BELOW NAMES NO MENUS, ON PURPOSE. It used to open
              "Retainage, prevailing wage, certified payroll and a few other
              menus", and two of those three were never affected by any answer:
              `ROUTE_HIDDEN_WHEN` hides `/submittals`, `/prevailing-wage` and
              `/union-compliance`, while retainage and certified payroll have no
              top-level route at all — they are job tabs, and
              `app/(app)/jobs/[id]/(tabs)/layout.tsx` does not consult business
              scope at all. businessScope.ts's own comment says so; this screen
              did not. A sentence that enumerates routes is false the day the map
              changes, so this one describes what the answers DO instead. Keep it
              that way: if you find yourself adding a menu name here, the map is
              the thing that moved. */}
          <section id="setup" className="mb-10">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Set up for your work</h2>
            <BusinessScopeSettingsForm scope={businessScope} isOwner={currentUser.role === "OWNER"} />
          </section>

          <section className="mb-10" data-tour="settings-locations">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Company locations</h2>

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
                    <ConfirmDeleteButton
                      describe="Takes this yard or office off the company record. No job and no crew is moved."
                      action={deleteCompanyLocation.bind(null, location.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            <Disclosure summary="Add a location">
              <form action={createCompanyLocation} className="flex flex-col gap-3">
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
            </Disclosure>
          </section>
        </>
      )}
      {tab === "estimating" && (
        <>
          <Disclosure summary="How this works" className="mb-8">
            <div className="flex flex-col gap-3 text-sm text-ink-body">
              <p>
                <span className="font-medium text-ink-label">Default markup</span> is what you
                normally add to the cost of the work: markup per kind of cost, then overhead, profit,
                tax, bond and contingency. These pre-fill the{" "}
                <span className="text-ink-label">Bid recap</span> on a new job — that job then keeps
                its own rates, so changing these never moves a bid you have already built or sent.
              </p>
              <p>
                <span className="font-medium text-ink-label">Phase codes</span> are your own cost
                codes, exactly as you write them on your own budget — a number and a name, like{" "}
                <span className="text-ink-label">04112 — Plywood - SF</span>. Free text on purpose:
                nothing here is checked against MasterFormat or any other standard list, so your
                reports read the way your budget already does. Coding a line item to one of these is
                what lets{" "}
                <Link href="/phase-codes" className="text-link hover:text-link-hover">
                  Phase codes
                </Link>{" "}
                total budget against actual for the same phase across every job.
              </p>
              <p>
                <span className="font-medium text-ink-label">Employer burden</span> is what an hour
                of work costs you BEYOND the wage and the CBA fringes — employer FICA, federal and
                state unemployment, workers&apos; comp premium. Entered as a percentage of the base
                wage, once a year, from whatever your accountant works it out against. It is added to
                the labor inside every job&apos;s cost to date, which moves percent complete, earned
                revenue and the WIP schedule.
              </p>
              <p className="text-xs text-ink-muted">
                The percentage is applied to the BASE WAGE only, not to the fringes — bona fide
                contributions to a benefit plan are generally outside the wage base employer payroll
                taxes are computed on, so burdening them again would count the same dollars twice.{" "}
                <span className="text-tag-amber-ink">
                  That is a modelling choice your CPA should confirm, not a tax rule this app verified.
                </span>
              </p>
            </div>
          </Disclosure>

          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">How you take off board</h2>
            {/* ── ITS OWN SECTION, NOT A FOURTH FIELD ABOVE ──
                It was inside the setup questions and could not be saved: those
                three radios are `required`, so the browser blocked the submit on a
                different question until all three were answered. See
                `OpeningDeductionForm.tsx`. Keeping it separate also reads better —
                that section is about which MENUS you see, and this one changes a
                quantity on a bid. */}
            <OpeningDeductionForm
              answer={businessScope.openingDeduction ?? null}
              thresholdSqFt={businessScope.openingDeductionSqFt ?? null}
              isOwner={currentUser.role === "OWNER"}
            />
            {/* ── FIND THE ROOMS, OFF UNTIL CHOSEN ──
                Shown to everyone so the absence of the button on the takeoff
                has an explanation somewhere a person can find; saved by the
                owner only. See `lib/takeoff/NOTES-rooms.md`. */}
            <div className="mt-4">
              <RoomFinderSwitch on={roomFinderOn} isOwner={currentUser.role === "OWNER"} />
            </div>
            <div className="mt-4">
              <DemotedWallsSwitch on={demotedWallsOn} isOwner={currentUser.role === "OWNER"} />
            </div>
          </section>

          {/* The standing markup, beside the phase codes: both are the company's
              own estimating vocabulary rather than compliance paperwork, and
              neither prices anything by itself — a job's recap keeps its own copy,
              so changing these never moves a bid already built. */}
          <section id="bid-defaults" className="mb-10" data-tour="settings-bid-defaults">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Default markup</h2>
            <BidDefaultsForm
              defaults={bidDefaults}
              wastePercent={bidDefaultsRow?.defaultWastePercent?.toString() ?? null}
            />
          </section>

          {/* Phase codes sit here, after the licences and before the insurance,
              because this is where the company's own reference data lives. The
              report they feed is its own page — this section is the vocabulary,
              not the numbers. */}
          <section id="phase-codes" className="mb-10" data-tour="settings-phase-codes">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Phase codes</h2>
            <PhaseCodes
              phaseCodes={phaseCodes.map((phaseCode) => ({
                id: phaseCode.id,
                code: phaseCode.code,
                name: phaseCode.name,
                unit: phaseCode.unit,
                tracksLabor: phaseCode.tracksLabor,
                isActive: phaseCode.isActive,
                sortOrder: phaseCode.sortOrder,
                lineItemCount: phaseCode._count.lineItems,
              }))}
              canManage={currentUser.role === "OWNER"}
            />
          </section>

          {/* Directly under phase codes because it is the other half of the same
              question — what a job actually costs. Every write here is
              owner-only, which this page already is. */}
          <section className="mb-10">
            <EmployerBurdenRates
              standing={employerBurdenStanding(employerBurdenRates, serverToday())}
              canDelete={currentUser.role === "OWNER"}
            />
          </section>
        </>
      )}
      {tab === "quickbooks" && (
        <>
          <Disclosure summary="How this works" className="mb-8">
            <div className="flex flex-col gap-3 text-sm text-ink-body">
              <p>
                Connects your QuickBooks Online company so invoices can be pushed to it. Deliberately
                ONE direction: C Stream writes to QuickBooks and reads the record back to confirm
                what landed. It does not pull edits made in QuickBooks back into C Stream, and does
                not pretend to — a sync that quietly loses an edit is worse than one that never
                claimed to carry it.
              </p>
              {/* The one exception, and it is not a sync: a one-time import of
                  the contractor's customers, vendors and products when they
                  start, so a new company is not typed in by hand. Read-only
                  toward QuickBooks — see lib/actions/quickbooksImport.ts. */}
              <p>
                Starting out? Once it is connected you can also bring your QuickBooks customers,
                vendors and products and services into C Stream, once, with a preview first. That
                only reads QuickBooks.
              </p>
            </div>
          </Disclosure>

          <section className="mb-10" data-tour="settings-quickbooks">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">QuickBooks Online</h2>

            {quickBooksCardState === "not-set-up" ? (
              // No keys on this install: say so, offer nothing to press. A
              // Connect button here would send the browser to
              // /api/quickbooks/start, which refuses before leaving the app
              // (see that route) rather than reaching Intuit and failing
              // there — but a button that always refuses is still a dead
              // button, so it does not render at all. Same wording shape as
              // JobberControls' "not-set-up" branch.
              <p className="max-w-md text-xs text-ink-muted" data-tour="quickbooks-not-set-up">
                Not set up on this install yet. Whoever runs C Stream for you has to add the
                QuickBooks app keys before this can connect.
              </p>
            ) : connection ? (
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
                      describe="Stops the push to QuickBooks until somebody reconnects. Nothing already in QuickBooks is changed or removed, and your chart-of-accounts mapping below is kept."
                      label="Disconnect"
                      confirmLabel="Confirm disconnect"
                      deleteClassName="text-sm text-danger hover:underline"
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

                {/* Its own anchor so /settings/import and the getting-started
                    step can link straight to it. */}
                <div id="quickbooks-import" className="mt-6 scroll-mt-6 border-t border-line-row pt-4">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-body">
                    Bring in what you already have
                  </h3>
                  <p className="mb-3 text-xs text-ink-muted">
                    Customers become clients, vendors become vendors, and products and services become
                    catalog entries. Read-only: nothing in QuickBooks is changed.
                  </p>
                  <QuickBooksImport />
                </div>

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
              <div id="quickbooks-import" className="scroll-mt-6">
                <a
                  href="/api/quickbooks/start"
                  className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
                >
                  Connect QuickBooks
                </a>
                <p className="mt-2 text-xs text-ink-muted" data-tour="qbo-import-connect-first">
                  Want to bring your QuickBooks customers, vendors and products in? Connect first — an
                  Import from QuickBooks button appears here once you are back.
                </p>
              </div>
            )}
          </section>
        </>
      )}
      {tab === "licences" && (
        <>
          <Disclosure summary="How this works" className="mb-8">
            <div className="flex flex-col gap-3 text-sm text-ink-body">
              <p>
                <span className="font-medium text-ink-label">Contractor licences:</span> one row per
                licence you hold, not per state — some jurisdictions have no state licence at all,
                only municipal ones, so working in two Colorado cities means two rows here.
              </p>
              <p>
                <span className="font-medium text-ink-label">Insurance policies</span> are this
                company&apos;s own coverage — the source data per-job certificates of insurance would
                eventually be generated from.
              </p>
              <p>
                <span className="font-medium text-ink-label">Bonding</span> holds licence bonds and
                overall performance/payment bonding capacity, and who to contact to increase it or
                pull a bond for a specific job.
              </p>
              <p>
                All three feed the renewals list on{" "}
                <Link href="/compliance" className="text-link hover:text-link-hover">
                  Compliance
                </Link>{" "}
                before anything lapses.
              </p>
            </div>
          </Disclosure>

          <section id="licences" className="mb-10" data-tour="settings-licences">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Contractor licences</h2>
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

          <section id="insurance" className="mb-10" data-tour="settings-insurance">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Insurance policies</h2>

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
                      <ConfirmDeleteButton
                        describe="Takes the policy off your record here only. Nothing is cancelled with the carrier, and a certificate a GC already holds still stands."
                        action={deleteInsurancePolicy.bind(null, policy.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <Disclosure summary="Add a policy">
              <form action={createInsurancePolicy} className="flex flex-col gap-3">
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
            </Disclosure>
          </section>

          <section id="bonding" data-tour="settings-bonding">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Bonding</h2>

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
                      <ConfirmDeleteButton
                        describe="Takes the bond off your record here only. Nothing is filed with the surety."
                        action={deleteBond.bind(null, bond.id)}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <Disclosure summary="Add a bond">
              <ActionForm action={createBond} className="flex flex-col gap-3">
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
                    <input name="aggregateBondingCapacity" type="text" inputMode="decimal" className={`w-48 ${inputClass}`} />
                  </label>
                  <label className={labelClass}>
                    Single job limit (optional)
                    <input name="singleJobLimit" type="text" inputMode="decimal" className={`w-48 ${inputClass}`} />
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
              </ActionForm>
            </Disclosure>
          </section>
        </>
      )}
      {tab === "appearance" && (
        <section id="appearance">
          <h2 className="mb-3 text-sm font-semibold text-ink-label">Appearance</h2>
          <p className="mb-3 text-sm text-ink-body">
            Light is easier to read outdoors. Saved on this device only.
          </p>
          <ThemeSwitch className="max-w-xs" />
        </section>
      )}
    </PageShell>
  );
}
