import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { cancelInvite, inviteTeamMember, removeTeamMember } from "@/lib/actions";

export default async function TeamPage() {
  const { company, ...currentUser } = await requireCompanyContext();
  const isOwner = currentUser.role === "OWNER";

  const [members, invites] = await Promise.all([
    prisma.user.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <AppHeader companyName={company.name} />

      <section className="mb-10">
        <h1 className="mb-3 text-lg font-semibold">Team members</h1>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{member.name ?? member.email}</p>
                <p className="text-sm text-slate-500">
                  {member.email} · {member.role}
                </p>
              </div>
              {isOwner && member.role !== "OWNER" && (
                <form action={removeTeamMember.bind(null, member.id)}>
                  <button type="submit" className="text-sm text-red-600 hover:underline">
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">Invite a teammate</h2>
            <form action={inviteTeamMember} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="teammate@example.com"
                  className="w-64 rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Invite
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              This doesn&apos;t send an email — share the sign-up link with them yourself. When they
              sign up with this email, they&apos;ll join your company automatically.
            </p>
          </section>

          {invites.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Pending invites</h2>
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between p-4">
                    <p className="text-sm">{invite.email}</p>
                    <form action={cancelInvite.bind(null, invite.id)}>
                      <button type="submit" className="text-sm text-red-600 hover:underline">
                        Cancel
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
