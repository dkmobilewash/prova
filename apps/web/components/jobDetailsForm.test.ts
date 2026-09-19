// @vitest-environment happy-dom

/**
 * On a contracted job the Client select is disabled — the client is who
 * signed. A disabled control is left out of a form's submitted data, so for
 * as long as that was the only `contactId` field, every "Save details" on a
 * contracted job reached the action without a client and was refused with
 * "A job needs a client." — no name, scope or site address could be saved.
 * Found clicking #344 on production.
 *
 * NOT `new FormData(form)`: happy-dom includes disabled controls in it, so a
 * test built on it passed against the broken form (checked). A browser sends
 * only ENABLED named controls, so that is the set this reads.
 */

import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions", () => ({ updateJobDetails: vi.fn(), deleteEstimateJob: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { JobDetailsForm } = await import("@/components/JobDetailsForm");

function submitted(isEstimate: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(JobDetailsForm, {
        jobId: "job-1",
        name: "Riverside",
        scope: null,
        contactId: "contact-1",
        contacts: [
          { id: "contact-1", name: "Acme GC" },
          { id: "contact-2", name: "Other GC" },
        ],
        isEstimate,
        canRemove: false,
        siteAddress: null,
        siteStatus: "none",
      }),
    );
  });
  const form = container.querySelector("form");
  if (!form) throw new Error("no form rendered");
  // What a browser would submit: named, enabled controls only.
  const sent = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name='contactId']")]
    .filter((el) => !el.disabled)
    .map((el) => el.value);
  act(() => root.unmount());
  container.remove();
  return sent;
}

describe("the job details form", () => {
  it("still sends the client on a contracted job, where the picker is disabled", () => {
    expect(submitted(false)).toEqual(["contact-1"]);
  });

  it("sends the picked client, once, on an estimate", () => {
    expect(submitted(true)).toEqual(["contact-1"]);
  });
});
