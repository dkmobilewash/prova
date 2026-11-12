// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Falafel Fresh flow walk: the person picked the PDF and then had to press "Add a drawing"
// for a choice already made. Picking the file is the decision; the upload starts on it.
const recordTakeoffPlan = vi.fn(async () => ({ ok: true }));
const uploadPlanSetFile = vi.fn(async () => ({ ok: true, fileUrl: "https://store.public.blob.vercel-storage.com/plans/j/a.pdf", fileName: "a.pdf" }));
vi.mock("@/lib/actions", () => ({ recordTakeoffPlan: (...args: unknown[]) => recordTakeoffPlan(...(args as [])) }));
vi.mock("@/lib/document-upload-client", () => ({ uploadPlanSetFile: (...args: unknown[]) => uploadPlanSetFile(...(args as [])) }));
const { TakeoffPlanUploader } = await import("./TakeoffPlanUploader");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  recordTakeoffPlan.mockClear();
  uploadPlanSetFile.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function pick(file: File | null): Promise<void> {
  act(() => root.render(createElement(TakeoffPlanUploader, { jobId: "job_1" })));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: file === null ? [] : [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("picking the drawing adds it", () => {
  it("uploads and saves on the pick, with no Add a drawing press", async () => {
    await pick(new File(["%PDF-1.7\n%stub"], "a.pdf", { type: "application/pdf" }));
    expect(uploadPlanSetFile).toHaveBeenCalledTimes(1);
    expect(recordTakeoffPlan).toHaveBeenCalledTimes(1);
  });

  it("a cancelled pick (no file) does nothing and says nothing", async () => {
    await pick(null);
    expect(uploadPlanSetFile).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("a file that is not a PDF is still refused with its sentence", async () => {
    await pick(new File(["GIF89a"], "a.gif", { type: "image/gif" }));
    expect(uploadPlanSetFile).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("That file isn't a PDF. Export the sheet to PDF and try again.");
  });
});
