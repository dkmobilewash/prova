import { headers } from "next/headers";
import { prisma } from "@prova/db";
import { PrintButton } from "@/components/PrintButton";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { ContractSummary } from "@/components/ContractSummary";
import { JobDetailsForm } from "@/components/JobDetailsForm";
import { JobBidDetails } from "@/components/JobBidDetails";
import { JobStatusControl } from "@/components/JobStatusControl";
import { RecordExecutedSubcontract } from "@/components/RecordExecutedSubcontract";
import { ContractDocumentUploadForm } from "@/components/ContractDocumentUploadForm";
import { DocuSignPanel } from "@/components/DocuSignPanel";
import { loadJobDocuSign } from "@/lib/docusign/views";
import {
  contractExecutionFor,
  contractIsExecuted,
  describeContractExecution,
  formatUtcDate,
} from "@/lib/contract-execution";
import type { JobStatusValue } from "@/lib/job-status-transitions";
import { requireJob, jobCapabilities } from "@/lib/jobs/job-access";
import { EXECUTED_CONTRACT_KEPT, executedContractIsKept } from "@/lib/billing/contract-document-rules";
import { dateInputValue } from "@/lib/jobs/date-input";
import { viewerTimeZone } from "@/lib/viewerToday";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { formatSignedDate } from "@/lib/signed-date";
import { SubmitButton } from "@/components/SubmitButton";
import {
  assignCrewMember,
  createSignatureRequest,
  revokeSignatureRequest,
  deleteContractDocument,
  unassignCrewMember,
  updateJobSchedule,
} from "@/lib/actions";

const rowDeleteClass = "text-xs text-red-400 hover:underline";
const rowCancelClass =
  "rounded-md border border-slate-700 px-2 py-1 text-xs text-ink-label hover:border-slate-500";
const rowConfirmClass =
  "rounded-md border border-red-500 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10";

/**
 * Overview — job details, status, schedule & crew, and the contract's own
 * paper trail (e-sign / DocuSign / uploaded subcontract). Everything below
 * this (pricing, time, billing, compliance, photos, field reports) moved to
 * its own route; see the sibling `page.tsx` files under this same
 * `(tabs)` group. This is `/jobs/[id]` itself — the entry point every
 * existing link and bookmark already points at.
 */
export default async function JobOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { company, currentUser, principal, job: jobRef } = await requireJob(id);
  const { showsJobMoney, showsJobManagement } = jobCapabilities(principal);

  const job = await prisma.job.findUnique({
    where: { id: jobRef.id },
    include: {
      contact: true,
      operatingLocation: true,
      signatureRequests: { orderBy: { createdAt: "desc" } },
      contractDocuments: {
        orderBy: { versionNumber: "desc" },
        include: { uploadedByUser: true },
      },
      assignments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      // Only for the printable ContractSummary — money-gated below, but
      // fetched unconditionally since it's cheap and keeps this one query.
      lineItems: {
        where: { isDeleted: false },
        orderBy: { createdAt: "asc" },
        include: { originChangeOrder: { select: { number: true } } },
      },
    },
  });
  if (!job) {
    // requireJob already proved this row exists and is this company's;
    // this can only be a race with a delete that cannot currently happen.
    throw new Error("job disappeared between checks");
  }

  const [jobDetailContacts, companyMembers, companyLocations] = await Promise.all([
    prisma.contact.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.companyLocation.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const assignedUserIds = new Set(job.assignments.map((a) => a.userId));
  const unassignedMembers = companyMembers.filter((m) => !assignedUserIds.has(m.id));

  const timeZone = await viewerTimeZone();
  const headerList = await headers();
  const origin = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}`;
  const pendingSignature = job.signatureRequests.find((r) => r.status === "PENDING");
  const signedSignature = job.signatureRequests.find((r) => r.status === "SIGNED");

  const contractExecution = contractExecutionFor(
    signedSignature ? { signerName: signedSignature.signerName, signedAt: signedSignature.signedAt } : null,
    job.contractDocuments.map((doc) => ({
      versionNumber: doc.versionNumber,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      executedSignedDate: doc.executedSignedDate,
      recordedAt: doc.createdAt,
      recordedByName: doc.uploadedByUser?.name ?? doc.uploadedByUser?.email ?? null,
    })),
  );
  const isContractExecuted = contractIsExecuted(contractExecution);

  const docuSign = showsJobMoney ? await loadJobDocuSign(company.id, job.id, timeZone) : null;
  const docuSignSigner = { name: job.contact.name, email: job.contact.email ?? "" };

  const updateScheduleWithId = updateJobSchedule.bind(null, job.id);
  const assignCrewWithId = assignCrewMember.bind(null, job.id);
  const unassignCrewWithId = (userId: string) => unassignCrewMember.bind(null, job.id, userId);
  const createSignatureRequestWithId = createSignatureRequest.bind(null, job.id);
  const revokeSignatureRequestWithId = (requestId: string) => revokeSignatureRequest.bind(null, requestId);

  return (
    <>
      {/* Contract-style summary — the same JobLineItem rows used as the
          estimate are rendered here as contract content, via the shared
          ContractSummary component also used by the public /esign/[token]
          signing page. Nothing below this heading is retyped anywhere.
          Deliberately OUTSIDE any print:hidden wrapper — the walkthrough's
          own "job-summary" step says "Print prints this part only." */}
      {showsJobMoney && (
        <div className="mb-10" data-tour="job-summary">
          <ContractSummary
            companyName={company.name}
            jobName={job.name}
            status={job.status}
            clientName={job.contact.name}
            scope={job.scope}
            lineItems={job.lineItems.map((item) => ({
              id: item.id,
              description: item.description,
              quantity: item.quantity.toString(),
              unit: item.unit,
              unitPrice: item.unitPrice?.toString() ?? null,
              changeOrderNumber: item.originChangeOrder?.number ?? null,
            }))}
            footer={<PrintButton />}
          />
        </div>
      )}

      <div className="print:hidden">
        {showsJobManagement && (
          <section className="mb-10" data-tour="job-details">
            <h2 className="mb-3 text-lg font-semibold text-slate-100">Job details</h2>
            <JobDetailsForm
              jobId={job.id}
              name={job.name}
              scope={job.scope}
              contactId={job.contactId}
              contacts={jobDetailContacts}
              isEstimate={job.status === "ESTIMATE"}
              canRemove={currentUser.role === "OWNER"}
              siteAddress={job.siteAddress ?? job.projectLocation}
              siteStatus={job.siteAddress === null ? "none" : job.siteLatitude !== null ? "found" : "notFound"}
            />
            <JobBidDetails
              projectLocation={job.projectLocation}
              bidDueDate={job.bidDueDate}
              bidResearch={job.bidResearch}
            />
          </section>
        )}

        {showsJobManagement && (
          <section className="mb-10" data-tour="job-status">
            <h2 className="mb-3 text-lg font-semibold text-ink">Job status</h2>
            <JobStatusControl jobId={job.id} status={job.status as JobStatusValue} />
          </section>
        )}

        {/* SCHEDULE AND CREW — SHOWN TO EVERYONE, EDITABLE BY MANAGE_JOBS.
            Cyrus's call, and the reasoning is worth keeping: a foreman
            should be able to see the schedule and who is on the job. That
            is field information, not money. Seeing who is on site tomorrow
            is not a management privilege; CHANGING it is. Hiding the whole
            box would take away something a foreman uses daily and would
            read as the product breaking rather than as a permission
            working.

            WHICH LINE IS LOAD-BEARING, because this repo has just spent a
            day on a doc comment that claimed a boundary the actions did
            not back up: NOT THIS ONE. Everything below is COURTESY — it
            decides what a person is offered, and a page decides nothing
            about what an endpoint accepts. The real boundary is the
            `can(context, "MANAGE_JOBS")` assertion inside
            `updateJobSchedule`, `assignCrewMember` and
            `unassignCrewMember` (lib/actions/jobs.ts), which refuses a
            direct POST from anyone lacking it whatever this file renders.
            Softening `showsJobManagement` here would change what is on
            screen and would NOT open the endpoints.

            Why read-only rather than simply leaving the controls up: a
            control that refuses on submit is worse than either hiding it
            or showing the value — it invites the click and then punishes
            it. Same shape as `CompanyLicenses`' `canManage` and
            `DocuSignPanel`'s `canSend`/`canVoid`: render the information,
            withhold the control. */}
        <section className="mb-10" data-tour="job-schedule">
          <h2 className="mb-3 text-lg font-semibold text-ink">Schedule</h2>
          <div className="rounded-lg border border-line-card bg-surface p-4">
            {showsJobManagement ? (
              <form action={updateScheduleWithId} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  Start date
                  <input
                    type="date"
                    name="startDate"
                    defaultValue={dateInputValue(job.startDate)}
                    className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  End date
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={dateInputValue(job.endDate)}
                    className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-ink-label">
                  Operating location
                  <select
                    name="operatingLocationId"
                    defaultValue={job.operatingLocationId ?? ""}
                    className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {companyLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name ?? `${location.city}, ${location.state}`}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton
                  type="submit"
                  className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
                >
                  Save dates
                </SubmitButton>
              </form>
            ) : (
              /* The same three facts, as plain text. `formatCalendarDate`
                 renders in UTC, which is how these are stored — the date a
                 foreman reads here is the same one the editable field
                 above shows an estimator. */
              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-ink-label">Start date</dt>
                  <dd className="text-ink">
                    {job.startDate ? formatCalendarDate(job.startDate) : "Not set"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-ink-label">End date</dt>
                  <dd className="text-ink">
                    {job.endDate ? formatCalendarDate(job.endDate) : "Not set"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-ink-label">Operating location</dt>
                  <dd className="text-ink">
                    {job.operatingLocation
                      ? job.operatingLocation.name ??
                        `${job.operatingLocation.city}, ${job.operatingLocation.state}`
                      : "Unassigned"}
                  </dd>
                </div>
              </dl>
            )}

            <div className="mt-4 border-t border-line-row pt-4">
              <p className="mb-2 text-sm font-medium text-ink-label">Crew</p>
              {job.assignments.length === 0 ? (
                <p className="text-sm text-ink-muted">No one assigned yet.</p>
              ) : (
                <ul className="mb-3 flex flex-col gap-1">
                  {job.assignments.map((assignment) => (
                    <li key={assignment.id} className="flex items-center justify-between text-sm">
                      <span className="text-ink">{assignment.user.name ?? assignment.user.email}</span>
                      {showsJobManagement && (
                        <RowActions
                          className="flex shrink-0 items-center justify-end gap-2"
                          destructive={
                            <ConfirmDelete
                              pinned="end"
                              action={unassignCrewWithId(assignment.userId)}
                              describe="Takes this person off this job's crew. Their account, and any hours they already logged here, are untouched."
                              label="Remove"
                              confirmLabel="Confirm remove"
                              deleteClassName={rowDeleteClass}
                              cancelClassName={rowCancelClass}
                              confirmClassName={rowConfirmClass}
                            />
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {showsJobManagement && unassignedMembers.length > 0 && (
                <form action={assignCrewWithId} className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm text-ink-label">
                    Assign teammate
                    <select
                      name="userId"
                      required
                      className="rounded-md border border-line-card bg-canvas px-3 py-2 text-ink focus:border-link focus:outline-none"
                    >
                      {unassignedMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name ?? member.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SubmitButton
                    type="submit"
                    className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
                  >
                    Assign
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        </section>

        {showsJobMoney && (
          <section className="mb-10" data-tour="job-signature">
            <h2 className="mb-3 text-lg font-semibold text-ink">Contract signature</h2>

            <div
              className={`mb-3 rounded-lg border p-4 ${
                isContractExecuted ? "border-green-700 bg-tag-green" : "border-line-card bg-surface"
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-ink-muted">How this contract was executed</p>
              <p className={`mt-1 text-sm ${isContractExecuted ? "text-tag-green-ink" : "text-ink-label"}`}>
                {describeContractExecution(contractExecution)}
              </p>
              {(contractExecution.route === "OFF_PLATFORM" || contractExecution.route === "BOTH") && (
                <p className="mt-1 text-xs text-ink-body">
                  Evidence: v{contractExecution.document.versionNumber}{" "}
                  <a
                    href={contractExecution.document.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link hover:underline"
                  >
                    {contractExecution.document.fileName}
                  </a>{" "}
                  — an off-platform signature C Stream did not witness. The file is the record.
                </p>
              )}
              {!isContractExecuted && showsJobManagement && (
                <div className="mt-3">
                  <RecordExecutedSubcontract jobId={job.id} />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-line-card bg-surface p-4">
              {signedSignature ? (
                <p className="text-sm text-green-400">
                  Signed by {signedSignature.signerName} on{" "}
                  {signedSignature.signedAt && formatSignedDate(signedSignature.signedAt, timeZone)}.
                </p>
              ) : pendingSignature && pendingSignature.revokedAt ? (
                <div className="text-sm">
                  <p className="mb-3 text-amber-400">This signing link was revoked and no longer works.</p>
                  <form action={createSignatureRequestWithId}>
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
                    >
                      Create a new signing link
                    </SubmitButton>
                  </form>
                </div>
              ) : pendingSignature ? (
                <div className="text-sm">
                  <p className="mb-2 text-ink-label">Waiting on the client to sign. Share this link with them:</p>
                  <p className="mb-3 break-all rounded-md bg-canvas px-3 py-2 font-mono text-xs text-link">
                    {origin}/esign/{pendingSignature.token}
                  </p>
                  {pendingSignature.expiresAt && (
                    <p className="mb-3 text-xs text-ink-muted">
                      Expires {formatSignedDate(pendingSignature.expiresAt, timeZone)}.
                    </p>
                  )}
                  <form action={revokeSignatureRequestWithId(pendingSignature.id)}>
                    <SubmitButton
                      type="submit"
                      className="rounded-md border border-rose-300 px-3 py-2 text-sm font-medium text-tag-rose-ink hover:bg-tag-rose"
                    >
                      Revoke signing link
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-sm text-ink-body">
                    No signing link yet. Once the client signs, this job can be marked as contracted.
                  </p>
                  <form action={createSignatureRequestWithId}>
                    <SubmitButton
                      type="submit"
                      className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-ink hover:bg-neutral-700"
                    >
                      Create signing link
                    </SubmitButton>
                  </form>
                </div>
              )}
              {docuSign && (
                <DocuSignPanel
                  state={docuSign.state}
                  jobId={job.id}
                  subject="CONTRACT_SUMMARY"
                  defaultSigner={docuSignSigner}
                  envelopes={docuSign.contractSummary}
                  canSend={job.status === "ESTIMATE" && !signedSignature}
                  canVoid={currentUser.role === "OWNER"}
                  autoUpdates={docuSign.autoUpdates}
                  sendLabel="Or send the contract with DocuSign"
                />
              )}
            </div>
          </section>
        )}

        {showsJobMoney && (
          <section className="mb-10">
            <h2 className="mb-1 text-lg font-semibold text-ink">Subcontract agreement</h2>
            <p className="mb-3 text-sm text-ink-body">
              The actual GC-to-sub contract file — separate from the e-sign snapshot above. Upload the
              original agreement, then any amendment the GC sends later as a new version; nothing is
              overwritten.
            </p>
            {job.contractDocuments.length > 0 && (
              <ul className="mb-4 divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {job.contractDocuments.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-medium text-ink">
                        v{doc.versionNumber}
                        {doc.versionNumber === 1 ? " (original)" : " (amendment)"}
                        {doc.executedSignedDate && (
                          <span className="ml-2 rounded-full bg-tag-green px-2 py-0.5 text-xs font-medium text-tag-green-ink">
                            Executed — GC signed {formatUtcDate(doc.executedSignedDate)}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-ink-body">
                        {doc.executedSignedDate ? "Recorded " : ""}
                        {formatInstant(doc.createdAt, timeZone, "numeric")}
                        {doc.uploadedByUser?.name || doc.uploadedByUser?.email
                          ? ` · ${doc.uploadedByUser.name ?? doc.uploadedByUser.email}`
                          : ""}
                      </p>
                      {doc.note && <p className="text-sm text-ink-muted">{doc.note}</p>}
                      <a
                        href={doc.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-link hover:underline"
                      >
                        {doc.fileName}
                      </a>
                      {docuSign && (
                        <DocuSignPanel
                          state={docuSign.state}
                          jobId={job.id}
                          subject="CONTRACT_DOCUMENT"
                          subjectId={doc.id}
                          defaultSigner={docuSignSigner}
                          envelopes={docuSign.byContractDocument.get(doc.id) ?? []}
                          canSend={!doc.executedSignedDate}
                          canVoid={currentUser.role === "OWNER"}
                          autoUpdates={docuSign.autoUpdates}
                        />
                      )}
                    </div>
                    {/* #351: the executed subcontract on a contracted job is
                        evidence, not a file — `deleteContractDocument` refuses
                        it, so the control is replaced by the sentence. */}
                    {executedContractIsKept(doc, job) ? (
                      <span className="max-w-[16rem] shrink-0 text-right text-xs text-ink-muted">
                        {EXECUTED_CONTRACT_KEPT}
                      </span>
                    ) : currentUser.role === "OWNER" && (
                      <RowActions
                        className="flex shrink-0 flex-col items-end gap-1"
                        destructive={
                          <ConfirmDelete
                            pinned="end"
                            action={deleteContractDocument.bind(null, doc.id)}
                            describe="Removes the document from this job. If a GC was ever sent it, their copy is unaffected — this only clears your record of it."
                            confirmLabel="Confirm delete"
                            armedClassName="flex flex-wrap items-center justify-end gap-2"
                            deleteClassName={rowDeleteClass}
                            cancelClassName={rowCancelClass}
                            confirmClassName={rowConfirmClass}
                            hint={
                              doc.executedSignedDate ? (
                                <span className="max-w-[16rem] text-right text-amber-300">
                                  This carries an executed date, but the job is still at estimate stage and
                                  nothing has been built on it. Deleting it removes the file and the signed date.
                                </span>
                              ) : (
                                <span className="max-w-[16rem] text-right text-ink-muted">
                                  The file goes with it.
                                </span>
                              )
                            }
                          />
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <ContractDocumentUploadForm jobId={job.id} hasDocuments={job.contractDocuments.length > 0} />
          </section>
        )}
      </div>
    </>
  );
}
