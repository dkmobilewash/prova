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
  const emailIsVerified =
    clerkUser.primaryEmailAddress?.verification?.status === "verified";

  // The same person arriving with a NEW clerkId. Both clerkId and email are
  // unique on User, so without this the create below fails on the email and
  // every page 500s — which is exactly what happened on production when the
  // Clerk instance moved from development keys to a custom domain: same
  // person, same address, a Clerk user id that had never been seen.
  //
  // Relinking is gated on Clerk having VERIFIED the address, and that gate
  // is the whole security of it. Clerk proves possession of the mailbox
  // before the account exists, and this app already treats a verified
  // address as sufficient to reach a company — that is precisely what the
  // Invite path below does. Without the gate, anyone who could sign up
  // naming someone else's address would inherit their company and its
  // money.
  const sameEmail = await prisma.user.findUnique({
    where: { email },
    include: { company: true },
  });
  if (sameEmail) {
    if (!emailIsVerified) {
      throw new Error(
        `An account already exists for ${email} and this sign-in has not verified that address.`,
      );
    }
    return prisma.user.update({
      where: { id: sameEmail.id },
      data: { clerkId: clerkUser.id, name: name ?? sameEmail.name },
      include: { company: true },
    });
  }

  try {
    // A pending invite means someone else's Company is waiting for this
    // email — join it as a MEMBER instead of creating a new Company.
    const invite = await prisma.invite.findUnique({ where: { email: normalizedEmail } });
    if (invite) {
      // The SAME gate the two paths above apply, and for the same reason.
      // It was missing here, which made this the one adoption path where
      // naming an address was enough to reach the company behind it: an
      // invitation to victim@example.com was consumable by whoever signed
      // up claiming to be them, and the result was a real MEMBER account
      // inside someone else's company, holding their jobs and their money.
      //
      // Clerk may well refuse to mint a session before it has verified an
      // address — but that is a DASHBOARD setting, not code, and there are
      // two Clerk instances here whose settings can differ. An access
      // check that is only true because of a checkbox in someone else's
      // console is not a check. This one is ours.
      if (!emailIsVerified) {
        throw new Error(
          `An invitation is pending for ${email} and this sign-in has not verified that address.`,
        );
      }
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
    // Concurrent first sign-in (two tabs, or someone else consuming the
    // same invite first) can race with the paths above; the loser re-reads
    // what the winner created.
    //
    // This used to re-read with findUniqueOrThrow on clerkId alone, which
    // assumed every Prisma error here was that race. An email collision is
    // not: the row that blocked the insert belongs to a DIFFERENT clerkId,
    // so the re-read found nothing and threw P2025 — turning a recoverable
    // situation into a 500 whose message named neither cause. Look under
    // both keys, and only give up when neither finds anything.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const byClerkId = await prisma.user.findUnique({
        where: { clerkId: clerkUser.id },
        include: { company: true },
      });
      if (byClerkId) return byClerkId;

      const byEmail = await prisma.user.findUnique({
        where: { email },
        include: { company: true },
      });
      if (byEmail && emailIsVerified) {
        return prisma.user.update({
          where: { id: byEmail.id },
          data: { clerkId: clerkUser.id, name: name ?? byEmail.name },
          include: { company: true },
        });
      }
    }
    throw error;
  }
}
