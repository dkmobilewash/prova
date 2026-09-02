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
      <h1 className="mb-2 text-xl font-semibold text-slate-100">Team</h1>
      <p className="mb-6 text-sm text-slate-400">
        Two separate things. <span className="text-slate-300">Owner</span> decides who can
        administer the account — invite, remove, connect an integration. A{" "}
        <span className="text-slate-300">job function</span> decides what someone sees, and leaving
        it unset gives the full office access every member has always had. An owner always has
        everything, whatever else is set.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Team members</h2>
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {members.map((member) => (
            <li key={member.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-slate-100">{member.name ?? member.email}</p>
                <p className="text-sm text-slate-400">
                  {member.email} · {member.role}
                </p>
                {/* Role and job function are two different questions —
                    who administers the account, and what the person does.
                    Shown as two lines so the Team page can't imply they
                    are one setting. An owner's access never depends on
                    the second, so it isn't shown for one. */}
                {member.role !== "OWNER" && (
                  <p className="text-sm text-slate-500">
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
            <h2 className="mb-3 text-sm font-semibold text-slate-300">Invite a teammate</h2>
            <form action={inviteTeamMember} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <SubmitButton
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Invite
              </SubmitButton>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              This doesn&apos;t send an email — share the sign-up link with them yourself. When they
              sign up with this email, they&apos;ll join your company automatically.
            </p>
          </section>

          {invites.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Pending invites</h2>
              <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between p-4">
                    <p className="text-sm text-slate-100">{invite.email}</p>
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
