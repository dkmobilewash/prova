import { prisma } from "@prova/db";
import { specTradeReadFrom, type SpecTradeRead } from "@prova/integrations/src/specTrade";
import { loadLegendProposals } from "@/lib/plan-ingest/legendProposalsQuery";
import { checkWallType, specSays, type SectionFacts, type SpecSay, type WallTypeSpecCheck } from "./specTradeFacts";

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
  /** Found on a plan sheet's own text (`drawingSpecs.ts`), not in a spec book: the title names the sheet. */
  fromDrawings: boolean;
};

export type SpecBookView = {
  books: { id: string; fileName: string | null; createdAt: Date; sectionCount: number; fromDrawings: boolean }[];
  /** True when the job has a plan set to look for printed specs on. */
  hasPlans: boolean;
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
      select: { id: true, fileName: true, fileUrl: true, createdAt: true, _count: { select: { sections: true } } },
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
    prisma.takeoffPlan.findMany({ where: { jobId, companyId }, select: { id: true, fileUrl: true } }),
  ]);

  // A "book" whose file IS one of the job's plan sets holds the notes found on the drawings.
  const planFiles = new Set(plans.map((p) => p.fileUrl));
  const drawingBooks = new Set(books.filter((b) => planFiles.has(b.fileUrl)).map((b) => b.id));
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
      fromDrawings: row.specBookId !== null && drawingBooks.has(row.specBookId),
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
  const facts = labelledFacts(sections);
  return {
    books: books.map((b) => ({ id: b.id, fileName: b.fileName, createdAt: b.createdAt, sectionCount: b._count.sections, fromDrawings: drawingBooks.has(b.id) })),
    hasPlans: plans.length > 0,
    sections,
    wallTypes: facts.length === 0 ? [] : [...types.values()].map((t) => checkWallType(t, facts)),
    hasLegend: types.size > 0,
  };
}

/** A drawing's notes are named by their sheet, so a wall's line says where to look: "09 21 16, sheet G001". */
function labelledFacts(sections: readonly Pick<SpecSectionView, "sectionNumber" | "title" | "fromDrawings" | "reading">[]): SectionFacts[] {
  return sections.flatMap((s) =>
    s.reading
      ? [{ sectionNumber: s.fromDrawings && s.title ? `${s.sectionNumber}, ${s.title.replace(/^Notes on /, "")}` : s.sectionNumber, read: s.reading.facts }]
      : [],
  );
}

/**
 * What the spec says that changes the price, per wall type code (upper-cased), for the review
 * queue and the estimate: every legend type on the job's plan sets and every company type, from
 * the job's spec reads — a spec book's sections and the notes printed on the drawings. `*` is for
 * a wall whose type is not known yet. Empty when the job has no spec read.
 */
/**
 * A job's spec reads, each named by its source — "09 21 16" for a spec book's section,
 * "09 21 16, sheet G001" for notes printed on a drawing — with the plans whose legends they are
 * checked against. One loader for the "spec says" notes and for Ask's spec answers, so the two
 * cannot read different things.
 */
export async function loadJobSpecFacts(jobId: string, companyId: string): Promise<{ facts: SectionFacts[]; plans: { id: string }[] }> {
  const [rows, plans] = await Promise.all([
    prisma.bidSpecSection.findMany({
      where: { OR: [{ job: { id: jobId, companyId } }, { bidInvitation: { wonJobId: jobId, companyId } }] },
      orderBy: { sectionNumber: "asc" },
      select: {
        sectionNumber: true,
        title: true,
        specBook: { select: { fileUrl: true } },
        tradeReadings: { orderBy: { createdAt: "desc" }, take: 1, select: { facts: true } },
      },
    }),
    prisma.takeoffPlan.findMany({ where: { jobId, companyId }, select: { id: true, fileUrl: true } }),
  ]);
  const planFiles = new Set(plans.map((p) => p.fileUrl));
  const facts = labelledFacts(
    rows.map((r) => ({
      sectionNumber: r.sectionNumber,
      title: r.title,
      fromDrawings: r.specBook !== null && planFiles.has(r.specBook.fileUrl),
      reading: r.tradeReadings[0] ? { id: "", on: new Date(0), facts: specTradeReadFrom(r.tradeReadings[0].facts) } : null,
    })),
  );
  return { facts, plans: plans.map((p) => ({ id: p.id })) };
}

export async function loadSpecSaysByCode(jobId: string, companyId: string): Promise<Record<string, SpecSay[]>> {
  const [{ facts, plans }, library] = await Promise.all([
    loadJobSpecFacts(jobId, companyId),
    prisma.wallType.findMany({ where: { companyId }, select: { code: true } }),
  ]);
  if (facts.length === 0) return {};
  const lines = new Map<string, string[] | null>();
  for (const plan of plans) {
    for (const proposal of await loadLegendProposals(plan.id)) {
      if (proposal.status === "REJECTED") continue;
      for (const t of proposal.types) if (!lines.has(t.code.toUpperCase())) lines.set(t.code.toUpperCase(), t.lines);
    }
  }
  for (const t of library) if (!lines.has(t.code.toUpperCase())) lines.set(t.code.toUpperCase(), null);
  const out: Record<string, SpecSay[]> = { "*": specSays(null, facts) };
  for (const [code, words] of lines) {
    const says = specSays(words, facts);
    if (says.length > 0) out[code] = says;
  }
  return out;
}
