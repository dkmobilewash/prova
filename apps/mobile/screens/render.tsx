import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";

/**
 * Mount a screen and read what it says.
 *
 * Deliberately tiny: this is not a testing library, it is the two calls
 * needed to answer "is that sentence on the page". `act` flushes the
 * effects a screen's load runs in, and `text()` is what a person can
 * read — which is the level every one of these bugs was reported at
 * ("the punch list says nothing outstanding", "there's no grey note").
 */
export async function mount(element: ReactElement): Promise<{
  text: () => string;
  settle: () => Promise<void>;
  unmount: () => void;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  const settle = async () => {
    // Two turns of the microtask queue plus a macrotask: enough for a
    // cached read (AsyncStorage is a promise, not a timer) and the state
    // it sets.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await settle();
  return {
    text: () => container.textContent ?? "",
    settle,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
