import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsedForm } from "./CollapsedForm";

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
});
