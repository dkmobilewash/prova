import { headers } from "next/headers";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { CancelInviteButton } from "@/components/CancelInviteButton";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { CrewRoster } from "@/components/CrewRoster";
import { InviteTeamMemberForm } from "@/components/InviteTeamMemberForm";
import { JobFunctionPicker } from "@/components/JobFunctionPicker";
import { TeamMemberActions } from "@/components/TeamMemberActions";
import { capabilityCount, jobFunctionLabel } from "@/components/permissionLabels";
import { can } from "@/lib/permissions";
import { crewMemberName } from "@/lib/worker-name";

export default async function TeamPage() {
  const context = await requireCompanyContext();
  const { company, ...currentUser } = context;
  const isOwner = currentUser.role === "OWNER";
  // Adding and editing crew is MANAGE_FIELD, not owner — the argument is in
  // lib/actions/crewMembers.ts. Setting which craft somebody works under is
  // MANAGE_COMPLIANCE, matching setWorkerCraft on /union-compliance, since
  // fringe rates and the apprentice ratio are computed from it. Archiving
  // keeps the owner gate: it is the one-way door, with no un-archive.
  const canManageCrew = can(context, "MANAGE_FIELD");
  const canSetCraft = can(context, "MANAGE_COMPLIANCE");

  const [members, invites, allCrew, craftClassifications] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    // Archived rows included in ONE query rather than counted separately:
    // the spreadsheet import needs them to say "already here" for somebody
    // who left and came back, and a second count query would have to agree
    // with this list about what "archived" means.
    prisma.crewMember.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        legalFirstName: true,
        legalMiddleName: true,
        legalLastName: true,
        employeeNumber: true,
        archivedAt: true,
        workerCrafts: {
          select: { craftClassification: { select: { id: true, name: true, unionLocal: { select: { localNumber: true, parentInternational: true } } } } },
        },
      },
      orderBy: [{ legalLastName: "asc" }, { legalFirstName: "asc" }],
    }),
    prisma.craftClassification.findMany({
      where: { companyId: company.id },
      select: { id: true, name: true, unionLocal: { select: { localNumber: true, parentInternational: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const craftOptions = craftClassifications.map((craft) => ({
    id: craft.id,
    label: `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`,
  }));

  const crew = allCrew
    .filter((member) => member.archivedAt === null)
    .map((member) => {
      // One craft is shown and one is written (see updateCrewMember). A
      // person can carry more than one WorkerCraft row from
      // /union-compliance's matrix, so this takes the first rather than
      // pretending the list is always length 0 or 1.
      const craft = member.workerCrafts[0]?.craftClassification ?? null;
      return {
        id: member.id,
        nameLabel: crewMemberName(member).label,
        employeeNumber: member.employeeNumber,
        craftClassificationId: craft?.id ?? null,
        craftLabel: craft
          ? `${craft.unionLocal.parentInternational} ${craft.unionLocal.localNumber} — ${craft.name}`
          : null,
      };
    });
  const archivedCrewCount = allCrew.length - crew.length;

  // The sign-up link the invite hint tells the owner to share. Built from
  // the request's own headers, same as the portal links on /contacts/[id] —
  // a brand-new owner does not know the sign-up URL, and a hint that names
  // a link without showing one is an email the teammate waits for forever.
  const headerList = await headers();
  const signUpUrl = `${headerList.get("x-forwarded-proto") ?? "https"}://${headerList.get("host")}/sign-up`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-2 text-xl font-semibold text-ink">Team</h1>
      {/* THE OLD VERSION OF THIS PARAGRAPH IS WORTH KNOWING ABOUT BEFORE
          ANYONE REWRITES IT AGAIN. It read: "Two separate things. Owner
          decides who can administer the account — invite, remove, connect an
          integration. A job function decides what someone sees, and leaving
          it unset gives the full office access every member has always had."
          Every sentence was true. It was also three clauses of permissions
          abstraction at the top of the page, aimed at a man who frames and
          hangs drywall, and "leaving it unset gives the full office access
          every member has always had" is a sentence about our data model.

          It is gone rather than reworded, because the controls already say
          it better than a paragraph can: the job-function dropdown's first
          option IS "Full office access (default)" and it prints what the
          choice means underneath, which is the version you read at the
          moment you are deciding. What the page needed at the top was not
          the permissions model — it was the fact that this page holds TWO
          KINDS OF PEOPLE, which is what nothing said and what left a
          contractor with no way to add the fifteen men who do the work. */}
      <p className="mb-6 text-sm text-ink-body">
        Two kinds of people. <span className="text-ink-label">Team members</span> sign in — the
        office, your PMs, a foreman with a tablet. <span className="text-ink-label">Crew</span> are
        the hands in the field: no login, no email needed, just their name so you can log their
        hours and put them on a certified payroll.
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

      {/* NEVER WRAP THIS IN A CONDITION. It was `{(crew.length > 0 ||
          archivedCrewCount > 0) && (…)}` for weeks, which hid the only way
          to create a crew member until a crew member existed — see the
          header of CrewRoster.tsx. `crewRoster.test.ts` reads this file and
          fails if the element is ever conditional again. */}
      <CrewRoster
        crew={crew}
        archivedCount={archivedCrewCount}
        craftOptions={craftOptions}
        existingCrew={allCrew}
        canManage={canManageCrew}
        canSetCraft={canSetCraft}
        canArchive={isOwner && canManageCrew}
      />

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
