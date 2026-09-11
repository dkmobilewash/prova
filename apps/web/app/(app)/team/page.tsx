import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { cancelInvite, inviteTeamMember, removeTeamMember } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { JobFunctionPicker } from "@/components/JobFunctionPicker";
import { capabilityCount, jobFunctionLabel } from "@/components/permissionLabels";

export default async function TeamPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const isOwner = currentUser.role === "OWNER";

  const [members, invites] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
  ]);

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

      <section className="mb-10">
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

              <div className="flex shrink-0 flex-col items-end gap-2">
                {isOwner && member.role !== "OWNER" && (
                  <JobFunctionPicker userId={member.id} current={member.jobFunction} />
                )}
                {isOwner && member.role !== "OWNER" && (
                  <form action={removeTeamMember.bind(null, member.id)}>
                    <SubmitButton type="submit" className="text-sm text-red-400 hover:underline">
                      Remove
                    </SubmitButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-sm font-semibold text-ink-label">Invite a teammate</h2>
            <form action={inviteTeamMember} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-ink-label">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  className="w-64 rounded-md border border-line-card bg-surface px-3 py-2 text-ink placeholder:text-ink-muted focus:border-link focus:outline-none"
                />
              </label>
              <SubmitButton
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-yellow-500"
              >
                Invite
              </SubmitButton>
            </form>
            <p className="mt-2 text-xs text-ink-muted">
              This doesn&apos;t send an email — share the sign-up link with them yourself. When they
              sign up with this email, they&apos;ll join your company automatically.
            </p>
          </section>

          {invites.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink-label">Pending invites</h2>
              <ul className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between p-4">
                    <p className="text-sm text-ink">{invite.email}</p>
                    <form action={cancelInvite.bind(null, invite.id)}>
                      <SubmitButton type="submit" className="text-sm text-red-400 hover:underline">
                        Cancel
                      </SubmitButton>
                    </form>
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
