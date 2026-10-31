import { prisma } from "@prova/db";
import type { GcOption } from "@/components/NewJobForm";

/**
 * The GC picker's rows for "start a job": every contact of the company, the
 * one with the most work on record first, so the GC somebody is most likely
 * opening a job for sits near the top and the accidental duplicate with
 * nothing on it sits at the bottom.
 *
 * Moved out of `app/(app)/jobs/new/page.tsx` unchanged so C Stream Bid's
 * "Start an estimate" (`app/bid/(signed-in)/estimates/new`) picks from the
 * same list in the same order — the picker is the default precisely because
 * the duplicate GC is the failure mode (see `NewJobForm`).
 */
export async function loadGcOptions(companyId: string): Promise<GcOption[]> {
  const contacts = await prisma.contact.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      email: true,
      _count: { select: { jobs: true } },
    },
    orderBy: [{ name: "asc" }],
  });

  return contacts
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      jobCount: contact._count.jobs,
    }))
    .sort((a, b) => b.jobCount - a.jobCount || a.name.localeCompare(b.name));
}
