// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TakeoffLayerPanel, type Layer } from "./TakeoffLayerPanel";

const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

const layer: Layer = { key: "wall:6.5:", name: "6-1/2\"", kind: "line", colour: "#000", count: 4, total: "128 ft", hidden: false };

function paint(names: Record<string, string>, onRename: (key: string, name: string) => Promise<string | null>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const props = { jobId: "j", layers: [layer], lit: null, onLit: () => {}, onToggle: () => {}, names, onRename };
  act(() => root.render(createElement(TakeoffLayerPanel, props)));
  return { host, root, props };
}
const q = (host: Element, hook: string) => host.querySelector(`[data-takeoff="${hook}"]`);

async function type(host: Element, value: string) {
  act(() => (q(host, "layer-name") as HTMLElement).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const box = q(host, "layer-rename") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => box.blur());
}

describe("a layer's name is the team's", () => {
  it("shows the saved name over the default, which stays in the tooltip", () => {
    const { host } = paint({ "wall:6.5:": "Corridor walls" }, vi.fn());
    expect(q(host, "layer-name")?.textContent).toBe("Corridor walls");
    expect(q(host, "layer-name")?.getAttribute("title")).toBe("Corridor walls (6-1/2\")");
  });

  it("saves a rename through the action, by the layer's key, and shows it at once", async () => {
    const onRename = vi.fn(async () => null);
    const { host } = paint({}, onRename);
    await type(host, "  Demising ");
    expect(onRename).toHaveBeenCalledWith("wall:6.5:", "Demising");
    expect(q(host, "layer-name")?.textContent).toBe("Demising");
  });

  it("typing the default back clears the saved name rather than saving a copy of it", async () => {
    const onRename = vi.fn(async () => null);
    const { host } = paint({ "wall:6.5:": "Corridor walls" }, onRename);
    await type(host, "6-1/2\"");
    expect(onRename).toHaveBeenCalledWith("wall:6.5:", "");
  });

  it("a refused save puts the name back and says why", async () => {
    const { host } = paint({}, async () => "Keep a layer name under 80 characters.");
    await type(host, "Too long, say");
    expect(q(host, "layer-name")?.textContent).toBe("6-1/2\"");
    expect(q(host, "layer-rename-error")?.textContent).toBe("Keep a layer name under 80 characters.");
  });

  it("an unchanged name saves nothing", async () => {
    const onRename = vi.fn(async () => null);
    const { host } = paint({}, onRename);
    await type(host, "6-1/2\"");
    expect(onRename).not.toHaveBeenCalled();
  });
});
