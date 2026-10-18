// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { HelpChannel } from "@/lib/help-request";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/lib/actions", () => ({ requestHelp: vi.fn() }));

const { HelpButton } = await import("./HelpButton");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function openPanel(channel: HelpChannel): string {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(HelpButton, { companyName: "Test Drywall", channel })));
  act(() => host.querySelector<HTMLButtonElement>('button[title="Ask us for help"]')!.click());
  const text = host.textContent ?? "";
  act(() => root.unmount());
  host.remove();
  return text;
}

// UX test 2026-10-11 (#28): a customer read "needs SUPPORT_EMAIL set".
describe("Help with no support address", () => {
  it("leaves out the ask-a-person section and never names an environment variable", () => {
    const text = openPanel({ kind: "unavailable", reason: "It needs SUPPORT_EMAIL set." });
    expect(text).toContain("Take the full tour");
    expect(text).not.toContain("SUPPORT_EMAIL");
    expect(text).not.toContain("Or ask a person");
  });

  it("still offers a person when there is an address", () => {
    expect(openPanel({ kind: "send", to: "help@example.com" })).toContain("Or ask a person");
  });
});
