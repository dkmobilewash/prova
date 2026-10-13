import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deviceStore, goOffline } from "./setup";
import { mount } from "./render";

// Every API function a mock (goOffline makes them all reject), keeping the
// real ApiError class: nothing here may reach a real server.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([k, v]) => [k, typeof v === "function" && k !== "ApiError" ? vi.fn() : v]),
  );
});

/**
 * Filing a near miss from the phone.
 *
 * The web form could file one (kept on the log, no OSHA case number) and
 * the phone could not: its outcome chips stopped at "First aid only", so a
 * foreman with a board that slid off the cart and missed somebody had to
 * either file it as an injury — which burns a case number on the 300 log —
 * or not file it. The chip is the whole fix on this side; the route had to
 * accept the value too (see the incidents route test).
 *
 * Offline on purpose: the write stays in the queue, which is the exact
 * payload the phone will POST.
 */

beforeEach(async () => {
  deviceStore.clear();
  await goOffline();
});

function queued() {
  return JSON.parse(deviceStore.get("prova.field-queue") ?? "[]") as Record<string, unknown>[];
}

function byText(text: string) {
  const node = Array.from(document.querySelectorAll("*")).find((n) => n.textContent === text);
  expect(node, `no node with text "${text}"`).toBeTruthy();
  return node as HTMLElement;
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("a near miss on the phone", () => {
  it("can be picked and is queued as NEAR_MISS", async () => {
    const { default: Safety } = await import("@/app/safety/[jobId]");
    const screen = await mount(<Safety />);
    await click(byText("Add incident"));

    const fields = Array.from(document.body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"));
    // Employee, then description (the date is its own control).
    await type(fields[0], "Marco Silva");
    await type(fields.find((f) => f instanceof HTMLTextAreaElement)!, "Board slid off the cart, missed him.");

    await click(byText("NEAR MISS"));
    await click(byText("Save incident"));

    const ops = queued();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "incident:create", jobId: "job_1", outcome: "NEAR_MISS" });
    screen.unmount();
  });
});
