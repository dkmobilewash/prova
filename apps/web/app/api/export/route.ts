import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { EXPORT_DATASETS, datasetByKey, exportFilename, toCsv } from "@/lib/export";

/**
 * "Give me everything." No ticket, no waiting, no sales call.
 *
 * A Route Handler rather than a Server Action because this returns a FILE.
 * Server Actions return values to the client component that called them;
 * a download needs a Response with its own content type and
 * Content-Disposition, which is what this is.
 *
 * OWNER-only, matching every other whole-company surface. Not because the
 * data is secret from the team — a member can already read most of it on
 * screen — but because one file containing every job, every price and
 * every employee's hours is a different object from any single page, and
 * it leaves the building.
 *
 * Two formats on purpose, and they are NOT the same file in two skins:
 *
 *   csv   one table, opens in Excel. Formula-leading characters are
 *         neutralised, so it is not byte-faithful. See lib/export.ts.
 *   json  every table, faithful. This is the one to hand another system.
 *
 * Building CSV to be safe in a spreadsheet and JSON to be faithful is the
 * only way both jobs get done; one behaviour for both would quietly do one
 * of them wrong.
 */

export const dynamic = "force-dynamic";

/** Prisma `select` from a dataset's column list. Explicit rather than
 * `findMany()` with no select: an unselected query returns whatever the
 * model happens to have, so a credential column added later would appear
 * in the export the day it was added. This asks for exactly the allowlist
 * and nothing else. */
function selectFor(columns: string[]): Record<string, true> {
  return Object.fromEntries(columns.map((c) => [c, true as const]));
}

type Delegate = { findMany: (args: unknown) => Promise<Record<string, unknown>[]> };

async function rowsFor(model: string, columns: string[], where: unknown) {
  const delegate = (prisma as unknown as Record<string, Delegate>)[model];
  return delegate.findMany({ where, select: selectFor(columns) });
}

export async function GET(request: NextRequest) {
  const context = await requireCompanyContext();
  if (context.role !== "OWNER") {
    // Plain text rather than a redirect: this URL is hit by a download, and
    // a redirect would silently save the sign-in page as a .csv file.
    return new NextResponse("Only the account owner can export company data.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const companyId = context.company.id;
  const today = new Date();
  const key = request.nextUrl.searchParams.get("dataset");

  if (key) {
    const dataset = datasetByKey(key);
    if (!dataset) {
      return new NextResponse(`No export called "${key}".`, {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const rows = await rowsFor(dataset.model, dataset.columns, dataset.scope(companyId));
    return new NextResponse(toCsv(dataset.columns, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFilename(dataset.key, today, "csv")}"`,
      },
    });
  }

  // Everything, as one file. Sequential rather than Promise.all: the pooled
  // connection is capped at 5 and eighteen concurrent findMany calls would
  // spend the export queueing. Nobody is watching a spinner here.
  const bundle: Record<string, unknown> = {
    exportedAt: today.toISOString(),
    company: { id: companyId, name: context.company.name },
    // Said in the file, not only in the UI, because the file is what
    // outlives this account.
    notIncluded: [
      "Integration credentials (QuickBooks and other connection tokens).",
      "Client portal links and contract signing links — live keys, not records.",
      "Uploaded files themselves; documents appear as their metadata rows.",
    ],
    datasets: {},
  };

  const datasets: Record<string, unknown> = {};
  for (const dataset of EXPORT_DATASETS) {
    datasets[dataset.key] = {
      label: dataset.label,
      note: dataset.note,
      rows: await rowsFor(dataset.model, dataset.columns, dataset.scope(companyId)),
    };
  }
  bundle.datasets = datasets;

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename("everything", today, "json")}"`,
    },
  });
}
