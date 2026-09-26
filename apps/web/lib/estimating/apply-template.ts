import { prisma } from "@prova/db";

import type { ActionResultWith } from "@/lib/actions/shared";
import { templateApplication, type TemplateItemInput } from "@/lib/estimate-templates";

import { catalogLineFields } from "./catalog-line";
import { NOT_ESTIMATE_STAGE } from "./draft-lines";

/**
 * Applying a saved template to a job's estimate.
 *
 * ONE TRANSACTION, because a template that got half-applied is worse than
 * one that failed: the estimator sees six of twelve lines and no way to tell
 * which six are missing without reading the template beside the estimate.
 *
 * APPENDS, never syncs — see `lib/estimate-templates.ts`'s header for why
 * that is the design rather than a shortcut. The collision warning computed
 * there is shown BEFORE the button is pressed; this writer does not refuse on
 * it, because a second floor's worth of the same lines is legitimate.
 *
 * Pricing comes from the catalog entry via `catalogLineFields`, the same
 * mapping `addCatalogLine` uses, so a template-added line and a hand-added
 * one are the same row. An item with no catalog entry lands as plain text
 * with no price — which is honest: nobody has said what it costs.
 */
export async function applyEstimateTemplate(
  companyId: string,
  input: { jobId: string; templateId: string },
): Promise<ActionResultWith<{ added: number; alreadyPresent: string[] }>> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, companyId },
    select: { id: true, status: true },
  });
  if (!job) return { ok: false, error: "That job is no longer on this company. Reload the page." };
  if (job.status !== "ESTIMATE") return { ok: false, error: NOT_ESTIMATE_STAGE };

  const template = await prisma.estimateTemplate.findFirst({
    where: { id: input.templateId, companyId },
    select: {
      name: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          description: true,
          unit: true,
          defaultQuantity: true,
          catalogEntryId: true,
          // The entry is loaded THROUGH the template item rather than
          // queried separately, so a catalog entry from another company
          // cannot be reached: the relation is already scoped by the
          // template's own companyId above.
          catalogEntry: {
            select: {
              id: true,
              description: true,
              unit: true,
              defaultUnitPrice: true,
              defaultBudgetedUnitCost: true,
              defaultLaborHours: true,
              productionRate: true,
              tradeScope: true,
              craftClassificationId: true,
            },
          },
        },
      },
    },
  });
  if (!template) return { ok: false, error: "That template is no longer on this company. Reload the page." };
  if (template.items.length === 0) {
    return { ok: false, error: `“${template.name}” has no lines on it yet, so there is nothing to add.` };
  }

  const existingLines = await prisma.jobLineItem.findMany({
    where: { jobId: job.id },
    select: { description: true, isDeleted: true },
  });

  // The SAME computation the screen showed before the press. Re-run here
  // rather than trusted from the form: the estimate may have moved on in the
  // minutes since, and a warning the person saw is not a warning about the
  // rows being written now.
  const items: TemplateItemInput[] = template.items.map((item) => ({
    id: item.id,
    description: item.description,
    unit: item.unit,
    defaultQuantity: item.defaultQuantity === null ? null : Number(item.defaultQuantity),
    catalogEntryId: item.catalogEntryId,
  }));
  const plan = templateApplication(items, existingLines);

  const byId = new Map(template.items.map((item) => [item.id, item.catalogEntry]));

  await prisma.$transaction(
    plan.lines.map((line, index) => {
      const entry = byId.get(items[index].id) ?? null;
      return prisma.jobLineItem.create({
        data: entry
          ? { jobId: job.id, ...catalogLineFields(entry), quantity: line.quantity }
          : {
              jobId: job.id,
              description: line.description,
              unit: line.unit,
              quantity: line.quantity,
            },
        select: { id: true },
      });
    }),
  );

  return { ok: true, value: { added: plan.lines.length, alreadyPresent: plan.alreadyPresent } };
}
