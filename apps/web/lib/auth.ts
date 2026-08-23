import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Prisma, prisma } from "@prova/db";

/**
 * Loads the signed-in user's Prova User + Company, creating both on first
 * sign-in. Call only from protected routes (middleware already enforces
 * auth, so an unauthenticated call here means something is misconfigured).
 */
export async function requireCompanyContext() {
  const clerkUser = await currentUser();
  if (!clerkUser) {
    redirect("/sign-in");
  }

  const existing = await prisma.user.findUnique({
    where: { clerkId: clerkUser.id },
    include: { company: true },
  });
  if (existing) {
    return existing;
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress ?? `${clerkUser.id}@unknown.local`;
  const normalizedEmail = email.toLowerCase();
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;

  try {
    // A pending invite means someone else's Company is waiting for this
    // email — join it as a MEMBER instead of creating a new Company.
    const invite = await prisma.invite.findUnique({ where: { email: normalizedEmail } });
    if (invite) {
      const [, created] = await prisma.$transaction([
        prisma.invite.delete({ where: { id: invite.id } }),
        prisma.user.create({
          data: {
            clerkId: clerkUser.id,
            email,
            name,
            role: "MEMBER",
            companyId: invite.companyId,
          },
          include: { company: true },
        }),
      ]);
      return created;
    }

    const companyName = name ? `${name}'s Company` : "My Company";
    const created = await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        name,
        role: "OWNER",
        company: {
          create: { name: companyName },
        },
      },
      include: { company: true },
    });
    return created;
  } catch (error) {
    // Concurrent first sign-in (e.g. two tabs, or someone else consuming
    // the same invite first) can race with the paths above; the loser just
    // re-reads what the winner created.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { clerkId: clerkUser.id },
        include: { company: true },
      });
      return user;
    }
    throw error;
  }
}
