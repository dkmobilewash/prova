"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { requireCompanyContext } from "@/lib/auth";
import { runPublicWorksSync } from "@/lib/public-works/sync";


/**
 * The button form of /api/public-works/sync: the operator presses it, one
 * or more slices pull, and the page re-renders with what arrived. Owner of
 * the operating company only — the same gate as the page.
 */
export type PublicWorksSyncResult = { ok: true; summary: string } | { ok: false; error: string };

export async function runPublicWorksSyncNow(): Promise<PublicWorksSyncResult> {
  const { company, ...user } = await requireCompanyContext();
  if (!company.isProvaOperator || user.role !== "OWNER") return { ok: false, error: "Only C Stream's own owner account can run the public-works sync." };
  try {
    const report = await runPublicWorksSync({ prisma, budgetMs: 40_000 });
    revalidatePath("/sales/public-works");
    if (report.slices.length === 0) return { ok: true, summary: "Everything is fresh — nothing older than a week." };
    const parts = report.slices.map((s) => `${s.key}: ${s.rows} rows${s.matched !== undefined ? `, ${s.matched} matched` : ""}`);
    return { ok: true, summary: `${parts.join("; ")}${report.stoppedBy === "budget" ? " — more left, press again." : "."}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The sync failed." };
  }
}
