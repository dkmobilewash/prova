import { headers } from "next/headers";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { ArchiveCrewButton } from "@/components/ArchiveCrewButton";
import { CancelInviteButton } from "@/components/CancelInviteButton";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { InviteTeamMemberForm } from "@/components/InviteTeamMemberForm";
import { JobFunctionPicker } from "@/components/JobFunctionPicker";
import { TeamMemberActions } from "@/components/TeamMemberActions";
import { capabilityCount, jobFunctionLabel } from "@/components/permissionLabels";
import { crewMemberName } from "@/lib/worker-name";

export default async function TeamPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const isOwner = currentUser.role === "OWNER";

  const [members, invites, crew, archivedCrewCount] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.crewMember.findMany({
      where: { companyId: company.id, archivedAt: null },
      select: { id: true, legalFirstName: true, legalMiddleName: true, legalLastName: true, employeeNumber: true },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
    }),
    prisma.crewMember.count({ where: { companyId: company.id, archivedAt: { not: null } } }),
  ]);

  // The sign-up link the invite hint tells the owner to share. Built from
  // the request's own headers, same as the portal links on /contacts/[id] —
  // a brand-new owner does not know the sign-up URL, and a hint that names
  // a link without showing one is an email the teammate waits for forever.
  const headerList = await headers();
  const signUpUrl = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}/sign-up`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Team</h1>
      <p className="mb-6 text-sm text-ink-body">
        Two separate things. <span className="text-ink-label">Owner</span> decides who can
        administer the account — invite, remove, connect an integration. A{" "}
        <span className="text-ink-label">job function</span> decides what someone sees, and leaving
        it unset gives the full office access every member has always had. An owner always has
        everything, whatever else is set.
      </p>

      <section className="mb-10" data-tour="team-members">
        <h2 className="mb-3 text-sm font-semibold text-ink-label">Team members</h2>
        <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-ink">{member.name ?? member.email}</p>
                <p className="text-sm text-ink-body">
                  {member.email} · {member.role}
                </p>
                {/* Role and job function are two different questions —
                    who administers the account, and what the person does.
                    Shown as two lines so the Team page can't imply they
                    are one setting. An owner's access never depends on
                    the second, so it isn't shown for one. */}
                {member.role !== "OWNER" && (
                  <p className="text-sm text-ink-muted">
                    {jobFunctionLabel(member.jobFunction)}
                    {(() => {
                      const { held, total } = capabilityCount(member.jobFunction);
                      return held < total ? ` · ${held} of ${total} areas` : "";
                    })()}
                  </p>
                )}
              </div>

              {/* The picker goes INSIDE the actions cluster rather than beside
                  it: arming the remove has to hide it, or the second click
                  lands on a permissions dropdown. TeamMemberActions carries
                  the geometry decision and the error line. */}
              {isOwner && member.role !== "OWNER" ? (
                <TeamMemberActions userId={member.id}>
                  <JobFunctionPicker userId={member.id} current={member.jobFunction} />
                </TeamMemberActions>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* Crew members: people whose hours are logged but who have no login.
          Added from Settings → Import; archived here when they leave. */}
      {(crew.length > 0 || archivedCrewCount > 0) && (
        <section className="mb-10">
          <h2 className="mb-1 text-sm font-semibold text-ink-label">Crew members</h2>
          <p className="mb-3 text-sm text-ink-muted">
            People whose hours are logged from the phone but who don&apos;t sign in. Archiving takes
            someone off the crew; their hours and their name on past payrolls stay as they are.
          </p>
          {crew.length > 0 ? (
            <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
              {crew.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{crewMemberName(member).label}</p>
                    {member.employeeNumber && (
                      <p className="text-xs text-ink-muted">Employee #{member.employeeNumber}</p>
                    )}
                  </div>
                  {isOwner ? <ArchiveCrewButton crewMemberId={member.id} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Everyone on the crew has been archived.</p>
          )}
          {archivedCrewCount > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              {archivedCrewCount} archived {archivedCrewCount === 1 ? "crew member is" : "crew members are"} kept
              for payroll history.
            </p>
          )}
        </section>
      )}

      {isOwner && (
        <>
          <section className="mb-10" data-tour="team-invite">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Invite a teammate</h2>
            <InviteTeamMemberForm />
            <p className="mt-2 text-xs text-ink-muted">
              This doesn&apos;t send an email — share the sign-up link below with them yourself. When
              they sign up with this email, they&apos;ll join your company automatically.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="break-all rounded-md bg-canvas px-3 py-2 font-mono text-xs text-link">
                {signUpUrl}
              </p>
              <CopyLinkButton url={signUpUrl} />
            </div>
          </section>

          {invites.length > 0 && (
            <section data-tour="team-pending">
              <h2 className="mb-3 text-sm font-semibold text-ink-label">Pending invites</h2>
              <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between p-4">
                    <p className="text-sm text-ink">{invite.email}</p>
                    <CancelInviteButton inviteId={invite.id} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
