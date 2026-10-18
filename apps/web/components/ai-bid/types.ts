import type { BidWorkspace } from "@/lib/agents/bidWorkspace";

/** The loader's own shapes, re-exported so the workspace and
 *  `loadBidWorkspace` cannot drift apart. Type-only: nothing here pulls the
 *  loader (or Prisma) into a client bundle. */
export type BidWorkspaceData = BidWorkspace;
export type FindingRow = BidWorkspace["research"][number];
export type Source = FindingRow["sources"][number];
export type Severity = "info" | "warn" | "flag";
