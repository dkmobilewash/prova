// @vitest-environment happy-dom

/**
 * The speaker controls in the real AskPanel: they render only where the
 * browser can speak, the toggle is remembered, and closing the panel (which
 * unmounts it — AskLauncher renders it only while open) silences it.
 * speechSynthesis is mocked; happy-dom has none.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/lib/actions", () => ({
  cancelAskProposal: vi.fn(),
  confirmAskProposal: vi.fn(),
  loadAskProposal: vi.fn(),
  prepareAskAttachment: vi.fn(),
  recordIntakeDocument: vi.fn(),
}));
vi.mock("@/lib/actions/askThreads", () => ({
  deleteThread: vi.fn(),
  loadAskThread: vi.fn(),
  renameThread: vi.fn(),
}));
vi.mock("@vercel/blob/client", () => ({ upload: vi.fn() }));
vi.mock("@/lib/intake/pdf-text", () => ({ firstPageTextPreview: vi.fn() }));

const { AskPanel } = await import("@/components/AskPanel");
const { READ_ALOUD_KEY } = await import("@/components/speechOutput");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const synth = { cancel: vi.fn(), speak: vi.fn() };
let container: HTMLDivElement;
let root: Root;

function mount() {
  act(() => root.render(<AskPanel />));
}
function button(name: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  synth.cancel.mockClear();
  synth.speak.mockClear();
  Object.assign(window, {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class {
      constructor(public text: string) {}
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  delete (window as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
});

describe("Ask panel voice controls", () => {
  it("are off by default, and the toggle is remembered", () => {
    mount();
    const toggle = button("Read replies aloud");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle!.click());
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(READ_ALOUD_KEY)).toBe("on");

    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(button("Read replies aloud")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("closing the panel stops the voice", () => {
    mount();
    expect(synth.cancel).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(synth.cancel).toHaveBeenCalled();
    root = createRoot(container); // for afterEach
  });

  it("speaks a finished reply as plain text when the toggle is on, and Stop silences it", async () => {
    window.localStorage.setItem(READ_ALOUD_KEY, "on");
    const lines = [
      { type: "answering" },
      { type: "text", delta: "**Two** invoices are [overdue](/billing)." },
      { type: "done", citations: [], links: [], toolsUsed: [] },
    ];
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    act(() => root.render(<AskPanel initialQuestion="what is overdue?" />));
    await act(async () => {
      (container.querySelector("button[type=submit]") as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.speak.mock.calls[0]![0].text).toBe("Two invoices are overdue.");
    expect(button("Stop reading")).toBeDefined();

    synth.cancel.mockClear();
    act(() => button("Stop reading")!.click());
    expect(synth.cancel).toHaveBeenCalled();
    expect(button("Stop reading")).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("conversation mode listens again after a silent turn and ends after two", () => {
    const made: { start: () => void; stop: () => void; onend: (() => void) | null }[] = [];
    Object.assign(window, {
      SpeechRecognition: class {
        onend: (() => void) | null = null;
        start = vi.fn();
        stop = vi.fn();
        constructor() {
          made.push(this);
        }
      },
    });
    try {
      mount();
      act(() => button("Talk it through")!.click());
      expect(button("End conversation")?.getAttribute("aria-pressed")).toBe("true");
      expect(made).toHaveLength(1);
      act(() => made[0]!.onend!()); // heard nothing
      expect(made).toHaveLength(2);
      expect(button("End conversation")).toBeDefined();
      act(() => made[1]!.onend!()); // nothing again
      expect(made).toHaveLength(2);
      expect(button("Talk it through")?.getAttribute("aria-pressed")).toBe("false");
    } finally {
      delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it("render nothing where the browser cannot speak", () => {
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    mount();
    expect(button("Read replies aloud")).toBeUndefined();
    expect(button("Talk it through")).toBeUndefined();
  });
});
