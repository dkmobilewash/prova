import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { cancelInvite, inviteTeamMember, removeTeamMember } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

export default async function TeamPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const isOwner = currentUser.role === "OWNER";

  const [members, invites] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-ink">Team</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Team members</h2>
        <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-slate-100">{member.name ?? member.email}</p>
                <p className="text-sm text-slate-400">
                  {member.email} · {member.role}
                </p>
              </div>
              {isOwner && member.role !== "OWNER" && (
                <form action={removeTeamMember.bind(null, member.id)}>
                  <SubmitButton type="submit" className="text-sm text-red-400 hover:underline">
                    Remove
                  </SubmitButton>
                </form>
              )}
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
