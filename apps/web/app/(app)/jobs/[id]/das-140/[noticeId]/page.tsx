// The DAS 140 itself, laid out as the form rather than as a report about it.
//
// A SIBLING of the job's (tabs) group, exactly like
// certified-payroll/wh-347: this is a FILING view, not a tab. Wrapping a
// document somebody prints in a tab rail it is not part of would be the wrong
// navigation, and the WH-347 page's own header makes the same call for the
// same reason.
//
// It deliberately refuses to look finished. Every box C Stream cannot source
// is printed IN PLACE, in red, as a sentence, and a banner at the top names
// them all. The secondary guidance on this form says writing "TBD", "N/A" or
// leaving a blank invalidates it, so a page that quietly renders an empty box
// is a page that hands somebody an invalid notice. See lib/das-print.ts.
//
// WIDTH COMES FROM PageShell, not from a `mx-auto max-w-*` of its own.
// `pageWidthCensus.test.ts` fails a route file for that, and its allowance
// list only ever shrinks — the WH-347 page is on it and this one is not
// joining it.

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@prova/ui";
import { prisma } from "@prova/db";
import { requireCapability } from "@/lib/authz";
import { NoAccess } from "@/components/NoAccess";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/money";
import { formatHours } from "@/lib/render-hours";
import { formatCalendarDay } from "@/lib/render-date";
import { buildDas140, DAS_BLOCKING_REASON } from "@/lib/das-print";
import { dasCitation, das140Standing, DAS140_STATUS_LABEL } from "@/lib/das-forms";
import { loadFirstWorkerDay } from "@/lib/das-query";
import { viewerToday } from "@/lib/viewerToday";

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/** What goes where a value should have been: a sentence, not a dash. Same
 * component and same reasoning as the WH-347 page's `Missing`. */
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

export default async function Das140Page({
  params,
}: {
  params: Promise<{ id: string; noticeId: string }>;
}) {
  const { id, noticeId } = await params;
  // The same capability the committee directory and the WH-347 demand.
  const { context, allowed } = await requireCapability("MANAGE_COMPLIANCE");
  if (!allowed) return <NoAccess capability="MANAGE_COMPLIANCE" />;
  const { company } = context;

  const notice = await prisma.das140Notice.findFirst({
    where: { id: noticeId, jobId: id, job: { companyId: company.id } },
    include: { committee: true, job: true },
  });
  if (!notice) notFound();

  const [licenses, firstWorkerDay, today] = await Promise.all([
    prisma.companyLicense.findMany({
      where: { companyId: company.id },
      select: { jurisdictionName: true, licenseNumber: true },
    }),
    loadFirstWorkerDay(id),
    viewerToday(),
  ]);

  const form = buildDas140({
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
      name: notice.job.name,
      siteAddress: notice.job.siteAddress,
      projectLocation: notice.job.projectLocation,
      awardingBody: notice.job.awardingBody,
      siteCounty: notice.job.siteCounty,
    },
    committee: notice.committee,
    notice: {
      craftName: notice.craftName,
      election: notice.election,
      contractExecutedOn: notice.contractExecutedOn.toISOString().slice(0, 10),
      estimatedJourneymanHours:
        notice.estimatedJourneymanHours === null ? null : Number(notice.estimatedJourneymanHours),
      estimatedApprenticeHours:
        notice.estimatedApprenticeHours === null ? null : Number(notice.estimatedApprenticeHours),
      estimatedStartOn: iso(notice.estimatedStartOn),
      estimatedCompletionOn: iso(notice.estimatedCompletionOn),
      contractAmount: notice.contractAmount === null ? null : Number(notice.contractAmount),
      projectIdentifier: notice.projectIdentifier,
      sentOn: iso(notice.sentOn),
    },
  });

  const standing = das140Standing(
    {
      contractExecutedOn: notice.contractExecutedOn.toISOString().slice(0, 10),
      sentOn: iso(notice.sentOn),
    },
    firstWorkerDay,
    today,
  );
  const tenDayRule = dasCitation("das140-ten-days");
  const notADispatch = dasCitation("das140-not-a-dispatch-request");

  return (
    <PageShell width="reading" className="print:px-0 print:py-0">
      <div className="print:hidden">
        <Link href={`/jobs/${id}/compliance`} className="text-sm text-link hover:underline">
          ← Compliance for this job
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink">DAS 140</h1>
            <p className="mt-1 text-sm text-ink-body">
              Public Works Contract Award Information · {notice.craftName} ·{" "}
              {notice.committee.name}
            </p>
          </div>
          <PrintButton />
        </div>

        <div className="mt-5 rounded-lg border border-line-card bg-surface p-4">
          <p className="text-sm text-ink-label">
            {DAS140_STATUS_LABEL[standing.status]} · due {formatCalendarDay(standing.dueOn)}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {standing.bound === "FIRST_WORKER"
              ? "The first day hours were logged on this job is earlier than ten days after the contract was executed, so that is the deadline."
              : "Ten days after the contract was executed. If anyone starts work on this job before then, the deadline moves to that day."}{" "}
            {tenDayRule.authority} — <strong>not confirmed against DIR.</strong> {tenDayRule.question}
          </p>
        </div>

        {/* First thing on the page, like the WH-347's, because the
            alternative is somebody signing a notice with an empty box in it. */}
        {/* `completeExceptSignature` rather than a constant: everything a
            person could have supplied IS here, and the one thing left is the
            signature, which C Stream will never supply. Saying that in amber
            beside a form that is genuinely finished is different from saying
            "not ready to send" on every form forever, which is what a red box
            counting the signature as a missing field amounted to. */}
        {form.completeExceptSignature ? (
          <div className="mt-4 rounded-lg border border-tag-amber-ink/40 bg-tag-amber/30 p-4">
            <p className="text-sm font-semibold text-tag-amber-ink">
              Every box C Stream can fill in is filled in. One thing is left, and it is not ours to
              do.
            </p>
            <p className="mt-1 text-xs text-tag-amber-ink/90">{DAS_BLOCKING_REASON.signature}</p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-red-300 bg-tag-rose p-4">
            <p className="text-sm font-semibold text-tag-rose-ink">
              This is not ready to send. {form.blocking.length}{" "}
              {form.blocking.length === 1 ? "thing is" : "things are"} missing.
            </p>
            <p className="mt-1 text-xs text-tag-rose-ink/80">
              The form below is real — what C Stream knows is in the right boxes. What follows is
              every field the form requires that it cannot fill in. Guidance on this form says
              writing &ldquo;TBD&rdquo;, &ldquo;N/A&rdquo; or leaving a blank invalidates it, so none
              of these is safe to skip.
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

      {/* The form sheet. White with black text — the only surface in the app
          that is not the dark product chrome, because it is a facsimile of a
          government document and it is read beside a pre-printed one. */}
      <div className="mt-6 border border-slate-300 bg-white p-6 text-black print:mt-0 print:border-0 print:p-0">
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            State of California · Department of Industrial Relations
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            Division of Apprenticeship Standards
          </p>
          <p className="mt-1 text-lg font-bold">Public Works Contract Award Information</p>
          <p className="mt-0.5 text-[10px] font-semibold">DAS Form 140</p>
          <p className="text-[10px]">
            Labor Code §1777.5 · 8 CCR §230 — see www.dir.ca.gov/das for the official form
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
                <span className="text-[10px] text-slate-600">
                  not recorded — fill in by hand if the committee expects one
                </span>
              )}
            </Row>
            <div className="col-span-2">
              <Row label="Address">
                {/* `address` is null unless the whole postal address is
                    there — a city on its own used to print here as though it
                    were an address. `addressGap` names which part is missing. */}
                {form.committee.address ?? <Missing>{form.committee.addressGap}</Missing>}
              </Row>
            </div>
            <Row label="Email">{form.committee.email ?? "—"}</Row>
            <Row label="Fax">{form.committee.fax ?? "—"}</Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">Contractor</p>
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
                {form.contractor.address ?? <Missing>{DAS_BLOCKING_REASON.contractorAddress}</Missing>}
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
              <Row label="Location">
                {form.project.location ?? <Missing>{DAS_BLOCKING_REASON.projectLocation}</Missing>}
              </Row>
            </div>
            <Row label="Awarding body">
              {form.project.awardingBody ?? <Missing>{DAS_BLOCKING_REASON.awardingBody}</Missing>}
            </Row>
            <Row label="County">{form.project.county ?? "—"}</Row>
            <Row label="Contract executed on">{form.contractExecutedOn}</Row>
            <Row label="Contract amount">
              {form.contractAmount === null ? "—" : money(form.contractAmount)}
            </Row>
            <Row label="Expected start">{form.estimatedStartOn ?? "—"}</Row>
            <Row label="Expected completion">{form.estimatedCompletionOn ?? "—"}</Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">Estimated employment on this craft</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <Row label="Journeyman hours">
              {form.estimatedJourneymanHours === null ? (
                <Missing>{DAS_BLOCKING_REASON.estimatedHours}</Missing>
              ) : (
                formatHours(form.estimatedJourneymanHours)
              )}
            </Row>
            <Row label="Apprentice hours">
              {form.estimatedApprenticeHours === null ? (
                <Missing>Entered by you — see the note beside journeyman hours.</Missing>
              ) : (
                formatHours(form.estimatedApprenticeHours)
              )}
            </Row>
          </div>
        </div>

        <div className="mt-3 border-b border-black pb-2 text-[11px]">
          <p className="mb-1.5 font-bold uppercase">Check one</p>
          <p>{form.electionLabel}</p>
          <p className="mt-1 text-[10px] text-slate-600">
            The wording of the three boxes here was read off secondary guidance, not off DIR&rsquo;s
            own form. Compare it against the official PDF before sending.
          </p>
        </div>

        <div className="mt-4 border-t-2 border-black pt-3 text-[11px]">
          <p className="font-bold uppercase">Signature</p>
          <p className="mt-1 text-[11px] text-red-600">{DAS_BLOCKING_REASON.signature}</p>
          <div className="mt-4 grid grid-cols-2 gap-6">
            <div className="border-t border-black pt-1 text-[10px]">Signature</div>
            <div className="border-t border-black pt-1 text-[10px]">Date</div>
          </div>
          <p className="mt-3 text-[10px]">
            This notice is contract award information. {notADispatch.claim} A dispatch request is a
            separate DAS 142.
          </p>
          {form.sentOn !== null && (
            <p className="mt-2 text-[10px]">
              <span className="font-semibold">Recorded as sent: </span>
              {form.sentOn}
            </p>
          )}
        </div>
      </div>
    </PageShell>
  );
}
