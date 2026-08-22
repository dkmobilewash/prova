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
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  const companyName = name ? `${name}'s Company` : "My Company";

  try {
    const created = await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        name,
        company: {
          create: { name: companyName },
        },
      },
      include: { company: true },
    });
    return created;
  } catch (error) {
    // Concurrent first sign-in (e.g. two tabs) can race to create the same
    // User row; the loser just re-reads what the winner created.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const user = await prisma.user.findUniqueOrThrow({
        where: { clerkId: clerkUser.id },
        include: { company: true },
      });
      return user;
    }
    throw error;
  }
}
