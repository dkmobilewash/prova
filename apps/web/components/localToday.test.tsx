// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { localToday, useLocalToday } from "./localToday";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function DateInput() {
  return createElement("input", { type: "date", name: "d", defaultValue: useLocalToday() });
}

// The server markup carries NO date (so it cannot disagree with hydration),
// and the input shows the user's date once mounted.
it("useLocalToday: empty in server markup, the user's date after mount", () => {
  expect(renderToString(createElement(DateInput))).not.toContain(localToday());

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(DateInput)));
  expect(host.querySelector("input")?.value).toBe(localToday());
  act(() => root.unmount());
  host.remove();
});
