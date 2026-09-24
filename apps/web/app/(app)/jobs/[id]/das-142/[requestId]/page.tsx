// The DAS 142 itself — the request to dispatch an apprentice.
//
// Same shape and same reasoning as the DAS 140 page beside it and the WH-347
// before both: a FILING view outside the job's (tabs) group, a white
// facsimile sheet, and every box C Stream cannot source printed in place, in
// red, as a sentence rather than left blank.
//
// THE ONE THING THIS PAGE DOES THAT THE OTHER TWO DO NOT: it prints the lead
// time WITH what the lead time could not account for. The rule is 72 hours
// excluding Saturdays, Sundays and holidays, held to the hour. C Stream stores
// a calendar day and holds no California holiday calendar, so the date shown is
// a latest send day that ignores holidays — and `lib/das-forms.ts` carries
// those two caveats as DATA on the form, so this page cannot render the date
// without them.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { formatCalendarDay } from "@/lib/render-date";
import { buildDas142, DAS_BLOCKING_REASON } from "@/lib/das-print";
import {
  das142Standing,
  dasCitation,
  DAS142_OUTCOME_LABEL,
  DAS142_STATUS_LABEL,
} from "@/lib/das-forms";
import { viewerToday } from "@/lib/viewerToday";

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium leading-tight text-red-600">{children}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-semibold">{label}: </span>
      {children}
    </div>
  );
}

export default async function Das142Page({
  params,
}: {
  params: Promise<{ id: string; requestId: string }>;
}) {
  const { id, requestId } = await params;
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company } = context;

  const request = await prisma.das142Request.findFirst({
    where: { id: requestId, jobId: id, job: { companyId: company.id } },
    include: { committee: true, job: true },
  });
  if (!request) notFound();

  const [licenses, today] = await Promise.all([
    prisma.companyLicense.findMany({
      where: { companyId: company.id },
      select: { jurisdictionName: true, licenseNumber: true },
    }),
    viewerToday(),
  ]);

  const form = buildDas142({
    company: {
      name: company.name,
      dbaName: company.dbaName,
      hqAddressLine1: company.hqAddressLine1,
      hqAddressLine2: company.hqAddressLine2,
      hqCity: company.hqCity,
      hqState: company.hqState,
      hqZip: company.hqZip,
      phone: company.phone,
      licenses,
    },
    job: {
      name: request.job.name,
      siteAddress: request.job.siteAddress,
      projectLocation: request.job.projectLocation,
      awardingBody: request.job.awardingBody,
      siteCounty: request.job.siteCounty,
    },
    committee: request.committee,
    request: {
      craftName: request.craftName,
      apprenticesRequested: request.apprenticesRequested,
      neededFrom: request.neededFrom.toISOString().slice(0, 10),
      neededTo: iso(request.neededTo),
      requestedOn: iso(request.requestedOn),
      projectIdentifier: request.projectIdentifier,
    },
  });

  const standing = das142Standing(
    {
      neededFrom: request.neededFrom.toISOString().slice(0, 10),
      requestedOn: iso(request.requestedOn),
      outcome: request.outcome,
    },
    today,
  );
  const leadTimeRule = dasCitation("das142-72-hours");

  return (
    <PageShell width="reading" className="print:px-0 print:py-0">
      <div className="print:hidden">
        <Link href={`/jobs/${id}/compliance`} className="text-sm text-link hover:underline">
          ← Compliance for this job
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">DAS 142</h1>
            <p className="mt-1 text-sm text-ink-body">
              Request for Dispatch of an Apprentice · {request.craftName} · {request.committee.name}
            </p>
          </div>
          <PrintButton />
        </div>

        <div className="mt-5 rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">
            {DAS142_STATUS_LABEL[standing.status]} · send by{" "}
            {formatCalendarDay(standing.latestSendDay)} · {DAS142_OUTCOME_LABEL[standing.outcome]}
          </p>
          {/* The caveats are on the standing, not written here, so this page
              cannot show the date without them. */}
          <ul className="mt-2 flex flex-col gap-1">
            {standing.caveats.map((caveat) => (
              <li key={caveat} className="text-xs leading-snug text-tag-amber-ink/80">
                {caveat}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            {leadTimeRule.authority} — <strong>not confirmed against DIR.</strong>{" "}
            {leadTimeRule.question}
          </p>
        </div>

        {form.blocking.length > 0 && (
          <div className="mt-4 rounded-lg border border-red-300 bg-tag-rose p-4">
            <p className="text-sm font-semibold text-tag-rose-ink">
              This is not ready to send. {form.blocking.length}{" "}
              {form.blocking.length === 1 ? "thing is" : "things are"} missing.
            </p>
            <p className="mt-1 text-xs text-tag-rose-ink/80">
              The form below is real. What follows is every field it requires that C Stream cannot
              fill in — and one of them is the committee&rsquo;s own contact details, which is the
              field a request gets refused on.
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {form.blocking.map((field) => (
                <li key={field} className="text-xs leading-snug text-tag-rose-ink">
                  {DAS_BLOCKING_REASON[field]}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-6 border border-slate-300 bg-white p-6 text-black print:mt-0 print:border-0 print:p-0">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            State of California · Department of Industrial Relations
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            Division of Apprenticeship Standards
          </p>
          <p className="mt-1 text-lg font-bold">Request for Dispatch of an Apprentice</p>
          <p className="mt-0.5 text-[10px] font-semibold">DAS Form 142</p>
          <p className="text-[10px]">
            Labor Code §1777.5 · 8 CCR §230.1 — see www.dir.ca.gov/das for the official form
          </p>
        </div>

        <div className="mt-4 border-y border-black py-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">To the apprenticeship committee</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <Row label="Committee">{form.committee.name}</Row>
            <Row label="Craft or trade">{form.committee.craftName}</Row>
            <Row label="Geographic area">{form.committee.geographicArea}</Row>
            <Row label="Program sponsor no.">
              {form.committee.programSponsorNumber ?? (
                <span className="text-[10px] text-slate-600">not recorded</span>
              )}
            </Row>
            <div className="col-span-2">
              <Row label="Address">
                {form.committee.address ?? (
                  <Missing>{DAS_BLOCKING_REASON.committeeDelivery}</Missing>
                )}
              </Row>
            </div>
            <Row label="Email">{form.committee.email ?? "—"}</Row>
            <Row label="Fax">{form.committee.fax ?? "—"}</Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">Contractor making the request</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <Row label="Name">{form.contractor.name}</Row>
            <Row label="California licence no.">
              {form.contractor.licenseNumber ?? (
                <Missing>
                  {DAS_BLOCKING_REASON.contractorLicense}
                  {form.contractor.licenseFoundInstead.length > 0 &&
                    ` Recorded instead: ${form.contractor.licenseFoundInstead.join(", ")}.`}
                </Missing>
              )}
            </Row>
            <div className="col-span-2">
              <Row label="Address">
                {form.contractor.address ?? (
                  <Missing>{DAS_BLOCKING_REASON.contractorAddress}</Missing>
                )}
              </Row>
            </div>
            <Row label="Telephone">{form.contractor.phone ?? "—"}</Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">The project</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <Row label="Project name">{form.project.name}</Row>
            <Row label="Project or contract no.">
              {form.project.identifier ?? <Missing>{DAS_BLOCKING_REASON.projectIdentifier}</Missing>}
            </Row>
            <div className="col-span-2">
              <Row label="Jobsite location">
                {form.project.location ?? <Missing>{DAS_BLOCKING_REASON.projectLocation}</Missing>}
              </Row>
            </div>
            <Row label="Awarding body">
              {form.project.awardingBody ?? <Missing>{DAS_BLOCKING_REASON.awardingBody}</Missing>}
            </Row>
            <Row label="County">{form.project.county ?? "—"}</Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">The request</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <Row label="Apprentices requested">{form.apprenticesRequested}</Row>
            <Row label="Craft or trade">{form.craftName}</Row>
            <Row label="Needed from">{form.neededFrom}</Row>
            <Row label="Through">{form.neededTo ?? "—"}</Row>
            <Row label="Request sent on">
              {form.requestedOn ?? (
                <span className="text-[10px] text-slate-600">
                  not yet — record the date after you send it
                </span>
              )}
            </Row>
            <Row label="Latest send day">{form.latestSendDay}</Row>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {form.leadTimeCaveats.map((caveat) => (
              <li key={caveat} className="text-[10px] leading-snug text-red-600">
                {caveat}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 border-t-2 border-black pt-3 text-[11px]">
          <p className="font-bold uppercase">Signature</p>
          <p className="mt-1 text-[11px] text-red-600">{DAS_BLOCKING_REASON.signature}</p>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div className="border-t border-black pt-1 text-[10px]">Signature</div>
            <div className="border-t border-black pt-1 text-[10px]">Date</div>
          </div>
          <p className="mt-3 text-[10px]">
            Keep your proof of submission. A committee that cannot dispatch an apprentice is the
            record that shows you asked — record their answer on the job&rsquo;s Compliance tab.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
