import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { stubAskEndpoint } from "../lib/stubAsk";

/**
 * The Ask panel opened FROM THE TOPBAR (AskLauncher, apps/web/components/
 * AskLauncher.tsx) — a client-side toggle, no URL change, distinct from
 * the dedicated /ask page. No real model call: POST /api/ask is stubbed
 * (see lib/stubAsk.ts).
 */
test.describe("Ask panel, opened from the topbar", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
  });

  test("opens from the topbar, and submitting a question shows the thinking state", async ({ page }) => {
    await page.goto("/dashboard");
    await stubAskEndpoint(page);

    const launcher = page.locator("[data-ask-launcher]");
    await expect(launcher).toHaveAttribute("aria-expanded", "false");
    await launcher.click();
    await expect(launcher).toHaveAttribute("aria-expanded", "true");

    const panel = page.getByRole("dialog", { name: "Ask C Stream" });
    await expect(panel).toBeVisible();

    const input = panel.getByLabel("Ask about your jobs");
    await input.fill("What is on my schedule this week?");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();

    // The synchronous state AskPanel sets on submit, before any response
    // has arrived — this is what the stub's artificial delay leaves room
    // to observe.
    await expect(panel.locator('[data-ask="progress"]')).toContainText("Thinking…");
  });
});
