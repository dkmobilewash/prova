import { expect, type Page } from "@playwright/test";

/**
 * Walking the waiver tool's steps the way a person does: Next, read the
 * screen, fill what is empty, Next again. Shared by the specs in this folder.
 */

/** Fill every EMPTY blank on the current screen with something valid, and
 * leave anything already filled (by memory or by a link) exactly as it is. */
export async function fillEmptyBlanks(page: Page, label = "Test") {
  for (const input of await page.locator("main input[id^='field-']").all()) {
    if ((await input.inputValue()) !== "") continue;
    const type = await input.getAttribute("type");
    if (type === "date") await input.fill("2026-09-30");
    else if ((await input.getAttribute("inputmode")) === "decimal") await input.fill("48250");
    else await input.fill(`${label} ${await input.getAttribute("name")}`);
  }
}

export const heading = (page: Page) => page.locator("main h2").first();

export async function next(page: Page) {
  await page.getByRole("button", { name: /^(Next|Looks right)$/ }).click();
}

/** From the waiver-type screen to "Get Your PDF", filling as it goes.
 * Returns the titles of the screens it passed through. */
export async function walkToSend(page: Page): Promise<string[]> {
  const seen: string[] = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const title = await heading(page).innerText();
    seen.push(title);
    if (title === "Get Your PDF") return seen;
    if (title !== "Waiver Type" && title !== "Read Your Waiver") await fillEmptyBlanks(page);
    await next(page);
  }
  throw new Error(`never reached the send screen; saw ${seen.join(" -> ")}`);
}

/** Every pageerror, so a spec can require there were none. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** React has hydrated: a fiber key on a real element. A page that never
 * hydrated would pass every check below by doing nothing. */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main *")].some((el) => Object.keys(el).some((key) => key.startsWith("__reactFiber$"))),
  );
  await expect(heading(page)).toBeVisible();
}
