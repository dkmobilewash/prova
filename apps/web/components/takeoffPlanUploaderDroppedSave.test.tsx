// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The synthetic check on a preview, 2026-11-11: the plan reached the store, the
// save request never reached the server, and the whole tab became the error
// boundary. A save that fails on the network must be a sentence instead.
const recordTakeoffPlan = vi.fn();
vi.mock("@/lib/actions", () => ({ recordTakeoffPlan: (...args: unknown[]) => recordTakeoffPlan(...args) }));
vi.mock("@/lib/document-upload-client", () => ({
  uploadPlanSetFile: async () => ({ ok: true, fileUrl: "https://store.public.blob.vercel-storage.com/plans/j/a.pdf", fileName: "a.pdf" }),
}));
const { TakeoffPlanUploader, SAVE_DROPPED } = await import("./TakeoffPlanUploader");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host, { onUncaughtError: () => {} });
  recordTakeoffPlan.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function addADrawing(): Promise<void> {
  act(() => root.render(createElement(TakeoffPlanUploader, { jobId: "job_1" })));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["%PDF-1.7\n%stub"], "a.pdf", { type: "application/pdf" })] });
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("Add a drawing, when the save request fails on the network", () => {
  it("says the save did not finish, and the form is still there", async () => {
    recordTakeoffPlan.mockRejectedValue(new TypeError("Failed to fetch"));
    await addADrawing();
    expect(recordTakeoffPlan).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(SAVE_DROPPED);
    expect(host.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("a refusal still shows the action's own sentence", async () => {
    recordTakeoffPlan.mockResolvedValue({ ok: false, error: "That job is closed." });
    await addADrawing();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That job is closed.");
  });
});
