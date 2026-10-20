/**
 * /messages after declutter round 3 (density audit #34): one setup warning,
 * not the amber card plus a sentence under it saying the same; and no red
 * banner restating the "Needs attention (N)" chip.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ sendOutboundEmail: vi.fn(), settleAskDraft: vi.fn() }));

const { MessageComposer } = await import("./MessageComposer");
const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/(app)/messages/page.tsx"), "utf8");

describe("/messages", () => {
  it("says nothing under the setup card when sending is off", () => {
    expect(renderToStaticMarkup(<MessageComposer jobs={[]} canSend={false} />)).toBe("");
  });

  it("still keeps an Ask draft's own sentence", () => {
    const draft = { proposalId: "p1" } as unknown as Parameters<typeof MessageComposer>[0]["draft"];
    expect(renderToStaticMarkup(<MessageComposer jobs={[]} canSend={false} draft={draft} />)).toContain("is not lost");
  });

  it("renders the status line only when it is quiet — the chip carries the problem count", () => {
    expect(page).toContain("{status.problems.length === 0 && <StatusLine report={status} />}");
    expect(page).toContain("Needs attention ({problemCount})");
  });
});
