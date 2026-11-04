// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The add revalidates /wall-types, the library stops being empty, and the page
 * stops offering the button. The answer has to outlive that: it lived in the
 * button's own state inside the empty state, and no one ever saw it.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/wall-types", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions", () => ({
  addStarterWallTypes: vi.fn(async () => ({ ok: true, value: { added: ["W1", "W2"] } })),
}));
const { StarterWallTypesButton } = await import("./WallTypes");

const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

describe("StarterWallTypesButton", () => {
  it("keeps saying what it added after the page stops offering it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(StarterWallTypesButton, { offer: true })));
    await act(async () => host.querySelector("button")!.click());
    act(() => root.render(createElement(StarterWallTypesButton, { offer: false })));
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("Added W1, W2.");
  });

  it("renders nothing when not offered and nothing was added", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(StarterWallTypesButton, { offer: false })));
    expect(host.innerHTML).toBe("");
  });
});
