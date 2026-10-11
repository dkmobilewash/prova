import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { stubAskEndpoint } from "../lib/stubAsk";

/**
 * The Ask panel reached FROM THE TOP BAR. No real model call: POST /api/ask
 * is stubbed (see lib/stubAsk.ts).
 *
 * Re-aimed 2026-10-11: for an owner the top bar's door to the assistant is
 * now the AI word (/ai), and the separate AskLauncher toggle is only drawn
 * for someone without the AI word (components/shell/TopBar.tsx). This spec
 * signs in as an owner, so it follows the AI word.
 */
test.describe("Ask panel, reached from the top bar", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
  });

  test("the AI word opens /ai, and submitting a question shows the thinking state", async ({ page }) => {
    await page.goto("/dashboard");
    await stubAskEndpoint(page);

    // An owner has the AI word and therefore no launcher beside it.
    await expect(page.locator("[data-ask-launcher]")).toHaveCount(0);
    await page.locator('nav[aria-label="Main"] a[href="/ai"]:visible').click();
    await expect(page).toHaveURL(/\/ai$/);

    const panel = page.locator('[data-tour="ai-chat"]');
    const input = panel.getByLabel("Ask about your jobs");
    await input.fill("What is on my schedule this week?");
    await panel.getByRole("button", { name: "Ask", exact: true }).click();

    // The synchronous state AskPanel sets on submit, before any response
    // has arrived — this is what the stub's artificial delay leaves room
    // to observe.
    await expect(panel.locator('[data-ask="progress"]')).toContainText("Thinking…");
  });
});
