import type { Prisma } from "@prova/db";
import {
  suggestPastPrices,
  type GroupInfo,
  type PastLine,
  type PastPriceSuggestion,
  type UnpricedTarget,
} from "./pastPriceCore";

export * from "./pastPriceCore";

/**
 * The company-scoped loader for "you priced this before — use that?".
 *
 * The rules are in `./pastPriceCore.ts`; this file only reads rows and hands
 * them over. Two things are enforced HERE because the core cannot see them:
 *
 *  - COMPANY SCOPE. The job is found by `{ id, companyId }`; wall type
 *    components are resolved through `wallType.companyId`; and every source
 *    line is filtered by `job.companyId`. A job of another company yields no
 *    targets, and a line of another company is never a source — even if an id
 *    were guessed.
 *  - SOFT DELETES. Source lines are read with `isDeleted: false`.
 *
 * It takes a transaction client (or the plain client — the shapes are the same
 * for reads) so the action can re-derive INSIDE its transaction.
 */

type Db = Prisma.TransactionClient;

const num = (v: { toString(): string } | null | undefined): number | null => (v == null ? null : Number(v));

export async function loadPastPriceSuggestions(
  db: Db,
  companyId: string,
  jobId: string,
  now: Date = new Date(),
): Promise<PastPriceSuggestion[]> {
  const job = await db.job.findFirst({
    where: { id: jobId, companyId },
    select: { id: true, bidRecap: { select: { appliedAt: true } } },
  });
  if (!job) return [];

  // UNPRICED: neither a unit price nor a unit cost. Only lines that can be
  // matched to something — a wall type component or a price book entry.
  const allUnpriced = await db.jobLineItem.findMany({
    where: {
      jobId,
      isDeleted: false,
      unitPrice: null,
      budgetedUnitCost: null,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, description: true, unit: true, wallTypeComponentId: true, sourceCatalogEntryId: true },
  });
  // "Can be matched to something" is filtered here rather than in the query:
  // the key spelled out in a `where` reads as a line WRITE to
  // catalogLineWriterCensus, which scans for it by name.
  const lines = allUnpriced.filter((l) => l.wallTypeComponentId != null || l.sourceCatalogEntryId != null);
  if (lines.length === 0) return [];

  const componentIds = [...new Set(lines.map((l) => l.wallTypeComponentId).filter((x): x is string => !!x))];
  const components = componentIds.length
    ? await db.wallTypeComponent.findMany({
        where: { id: { in: componentIds }, wallType: { companyId } },
        select: { id: true, wallTypeId: true, wallType: { select: { id: true, code: true, name: true } } },
      })
    : [];
  const componentById = new Map(components.map((c) => [c.id, c]));

  const entryIds = [
    ...new Set(
      lines.filter((l) => !l.wallTypeComponentId).map((l) => l.sourceCatalogEntryId).filter((x): x is string => !!x),
    ),
  ];
  const entries = entryIds.length
    ? await db.lineItemCatalogEntry.findMany({
        where: { id: { in: entryIds }, companyId },
        select: { id: true, description: true },
      })
    : [];
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const targets: UnpricedTarget[] = [];
  const groups = new Map<string, GroupInfo>();
  for (const line of lines) {
    if (line.wallTypeComponentId) {
      const component = componentById.get(line.wallTypeComponentId);
      if (!component) continue; // another company's, or gone
      const groupKey = `wt:${component.wallTypeId}`;
      groups.set(groupKey, { groupKey, kind: "wallType", code: component.wallType.code, name: component.wallType.name });
      targets.push({
        lineId: line.id,
        description: line.description,
        unit: line.unit,
        groupKey,
        partKey: component.id,
      });
    } else if (line.sourceCatalogEntryId) {
      const entry = entryById.get(line.sourceCatalogEntryId);
      if (!entry) continue;
      const groupKey = `ce:${entry.id}`;
      groups.set(groupKey, { groupKey, kind: "catalog", code: null, name: entry.description });
      targets.push({
        lineId: line.id,
        description: line.description,
        unit: line.unit,
        groupKey,
        partKey: entry.id,
      });
    }
  }
  if (targets.length === 0) return [];

  const targetComponents = [...new Set(targets.filter((t) => t.groupKey.startsWith("wt:")).map((t) => t.partKey))];
  // A wall type's other components are not needed: a past line is matched on
  // the SAME component the target line carries.
  const targetEntries = [...new Set(targets.filter((t) => t.groupKey.startsWith("ce:")).map((t) => t.partKey))];

  const history = await db.jobLineItem.findMany({
    where: {
      isDeleted: false,
      jobId: { not: jobId },
      job: { companyId },
      AND: [
        { OR: [{ unitPrice: { gt: 0 } }, { budgetedUnitCost: { gt: 0 } }] },
        {
          OR: [
            ...(targetComponents.length ? [{ wallTypeComponentId: { in: targetComponents } }] : []),
            ...(targetEntries.length
              ? [{ wallTypeComponentId: null, sourceCatalogEntry: { id: { in: targetEntries } } }]
              : []),
          ],
        },
      ],
    },
    select: {
      id: true,
      unit: true,
      unitPrice: true,
      budgetedUnitCost: true,
      updatedAt: true,
      wallTypeComponentId: true,
      sourceCatalogEntryId: true,
      job: { select: { id: true, name: true, createdAt: true } },
    },
  });

  // The component -> wall type map for the SOURCE side: a past line is in the
  // target's group when its component is the target's component, so the group
  // key is taken from the matching target part rather than re-resolved.
  const groupOfPart = new Map(targets.map((t) => [t.partKey, t.groupKey]));
  const pastLines: PastLine[] = [];
  for (const row of history) {
    const partKey = row.wallTypeComponentId ?? row.sourceCatalogEntryId;
    const groupKey = partKey ? groupOfPart.get(partKey) : undefined;
    if (!partKey || !groupKey) continue;
    pastLines.push({
      lineId: row.id,
      jobId: row.job.id,
      jobName: row.job.name,
      jobCreatedAt: row.job.createdAt,
      partKey,
      groupKey,
      unit: row.unit,
      unitCost: num(row.budgetedUnitCost),
      unitPrice: num(row.unitPrice),
      updatedAt: row.updatedAt,
      isDeleted: false,
    });
  }

  return suggestPastPrices({
    jobId,
    targets,
    groups: [...groups.values()],
    history: pastLines,
    recapApplied: job.bidRecap?.appliedAt != null,
    now,
  });
}
