// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollapsedForm } from "./CollapsedForm";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe("CollapsedForm", () => {
  it("starts closed: the button, and none of the form", () => {
    const html = renderToStaticMarkup(
      <CollapsedForm label="Add a catalog entry">
        <input name="description" />
      </CollapsedForm>,
    );
    expect(html).toContain("Add a catalog entry");
    expect(html).not.toContain('name="description"');
  });

  it("renders the form when told to start open", () => {
    const html = renderToStaticMarkup(
      <CollapsedForm label="Add a catalog entry" startOpen>
        <input name="description" />
      </CollapsedForm>,
    );
    expect(html).toContain('name="description"');
    expect(html).toContain("Close");
  });

  it("is the page's yellow primary by default and quiet when told so", () => {
    const primary = renderToStaticMarkup(<CollapsedForm label="Log time">x</CollapsedForm>);
    const secondary = renderToStaticMarkup(
      <CollapsedForm label="Log dispatch" tone="secondary">
        x
      </CollapsedForm>,
    );
    expect(primary).toContain("bg-brand");
    expect(secondary).not.toContain("bg-brand");
    expect(secondary).toContain("border-line-card");
  });

  it("the closed button carries the hash id, so a #link lands on it", () => {
    const html = renderToStaticMarkup(
      <CollapsedForm label="Log time" openOnHash="log-time">
        x
      </CollapsedForm>,
    );
    expect(html).toContain('id="log-time"');
  });

  describe("opens itself when the URL hash names it", () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    });
    afterEach(() => {
      act(() => root.unmount());
      container.remove();
      window.location.hash = "";
    });

    it("stays closed on a plain visit, opens on #log-time", async () => {
      window.location.hash = "";
      await act(async () => {
        root.render(
          <CollapsedForm label="Log time" openOnHash="log-time">
            <input name="hours" />
          </CollapsedForm>,
        );
      });
      expect(container.querySelector('input[name="hours"]')).toBeNull();

      await act(async () => {
        window.location.hash = "#log-time";
        window.dispatchEvent(new Event("hashchange"));
      });
      expect(container.querySelector('input[name="hours"]')).not.toBeNull();
    });

    it("is open on arrival when the hash is already there", async () => {
      window.location.hash = "#log-time";
      await act(async () => {
        root.render(
          <CollapsedForm label="Log time" openOnHash="log-time">
            <input name="hours" />
          </CollapsedForm>,
        );
      });
      expect(container.querySelector('input[name="hours"]')).not.toBeNull();
    });

    it("ignores a hash for some other section", async () => {
      window.location.hash = "#dispatch";
      await act(async () => {
        root.render(
          <CollapsedForm label="Log time" openOnHash="log-time">
            <input name="hours" />
          </CollapsedForm>,
        );
      });
      expect(container.querySelector('input[name="hours"]')).toBeNull();
    });
  });
});
