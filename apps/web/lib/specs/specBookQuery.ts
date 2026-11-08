import { prisma } from "@prova/db";
import { specTradeReadFrom, type SpecTradeRead } from "@prova/integrations/src/specTrade";
import { loadLegendProposals } from "@/lib/plan-ingest/legendProposalsQuery";
import { checkWallType, type WallTypeSpecCheck } from "./specTradeFacts";

/**
 * What the Specs tab shows: the job's spec books, every section with its newest
 * trade read, and each legend wall type checked against those reads. The checks are
 * worked out here, at read time, from rows that already exist — derived state is
 * never stored.
 */
export type SpecSectionView = {
  id: string;
  sectionNumber: string;
  title: string | null;
  specBookId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  reading: { id: string; facts: SpecTradeRead; on: Date } | null;
};

export type SpecBookView = {
  books: { id: string; fileName: string | null; createdAt: Date; sectionCount: number }[];
  sections: SpecSectionView[];
  wallTypes: WallTypeSpecCheck[];
  /** True when the job has a plan set whose legend has been read. */
  hasLegend: boolean;
};

export async function loadSpecBookView(jobId: string, companyId: string): Promise<SpecBookView> {
  const [books, rows, plans] = await Promise.all([
    prisma.specBook.findMany({
      where: { jobId, job: { companyId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, fileName: true, createdAt: true, _count: { select: { sections: true } } },
    }),
    prisma.bidSpecSection.findMany({
      where: { OR: [{ job: { id: jobId, companyId } }, { bidInvitation: { wonJobId: jobId, companyId } }] },
      orderBy: { sectionNumber: "asc" },
      select: {
        id: true,
        sectionNumber: true,
        title: true,
        specBookId: true,
        pageFrom: true,
        pageTo: true,
        tradeReadings: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, facts: true, createdAt: true } },
      },
    }),
    prisma.takeoffPlan.findMany({ where: { jobId, companyId }, select: { id: true } }),
  ]);

  const sections: SpecSectionView[] = rows.map((row) => {
    const newest = row.tradeReadings[0];
    return {
      id: row.id,
      sectionNumber: row.sectionNumber,
      title: row.title,
      specBookId: row.specBookId,
      pageFrom: row.pageFrom,
      pageTo: row.pageTo,
      reading: newest ? { id: newest.id, facts: specTradeReadFrom(newest.facts), on: newest.createdAt } : null,
    };
  });

  // Every legend type on the job's plan sets, the first read of a code winning.
  const types = new Map<string, { code: string; lines: string[] }>();
  for (const plan of plans) {
    for (const proposal of await loadLegendProposals(plan.id)) {
      if (proposal.status === "REJECTED") continue;
      for (const type of proposal.types) if (!types.has(type.code)) types.set(type.code, { code: type.code, lines: type.lines });
    }
  }
  const facts = sections.flatMap((s) => (s.reading ? [{ sectionNumber: s.sectionNumber, read: s.reading.facts }] : []));
  return {
    books: books.map((b) => ({ id: b.id, fileName: b.fileName, createdAt: b.createdAt, sectionCount: b._count.sections })),
    sections,
    wallTypes: facts.length === 0 ? [] : [...types.values()].map((t) => checkWallType(t, facts)),
    hasLegend: types.size > 0,
  };
}
