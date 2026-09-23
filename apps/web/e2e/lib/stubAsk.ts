import type { Page } from "@playwright/test";

/**
 * Intercepts `POST /api/ask` (apps/web/app/api/ask/route.ts, a route
 * handler streaming newline-delimited JSON — not a Server Action) and
 * fulfills it locally instead of letting it reach the model.
 *
 * Why stub rather than let it run: the task this suite exists for is
 * explicit that E2E must not spend real model calls, and this repo's own
 * memory (eval-spend-scope) already has a scar about an eval run emptying
 * a shared credit balance. A short artificial delay before fulfilling
 * gives the panel's own synchronous "Thinking…" state room to be observed
 * before the stub resolves — that state is set by AskPanel.tsx itself on
 * submit, before any response arrives, so the delay is generosity for the
 * assertion rather than a requirement of the component.
 *
 * The fulfilled body is deliberately minimal (`answering` then `done`) —
 * this suite asserts the request was issued and the thinking state
 * appeared, not the exact shape of a rendered answer, which is unit-test
 * territory (and already covered there).
 */
export async function stubAskEndpoint(page: Page): Promise<{ lastRequestBody: () => string | null }> {
  let lastBody: string | null = null;
  await page.route("**/api/ask", async (route) => {
    lastBody = route.request().postData();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: `${JSON.stringify({ type: "answering" })}\n${JSON.stringify({ type: "done" })}\n`,
    });
  });
  return { lastRequestBody: () => lastBody };
}
