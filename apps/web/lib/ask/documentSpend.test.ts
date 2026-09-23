import { describe, expect, it } from "vitest";
import { ASK_MONTHLY_ALLOWANCE } from "./allowance";
import {
  SINGLE_DOCUMENT_ALLOWANCE_FRACTION,
  singleDocumentPageCeiling,
} from "./documentSpend";

/**
 * The one number this module adds — the ceiling on a SINGLE document — and
 * the property that matters about it: it is DERIVED from the allowance, not
 * typed out beside it.
 *
 * A literal `100` here would be a second source of truth for a figure that
 * already has one, and it would silently stop meaning "a third of the
 * month" the first time a plan changes `allowanceForCompany`. That is the
 * failure this repo is most careful about, so it is pinned rather than
 * trusted: the cases below move the allowance and require the ceiling to
 * move with it.
 *
 * The behaviour around the ceiling — a document over it refused before
 * anything is claimed, a document exactly on it let through — is proved
 * where it happens, in lib/actions/complianceUploadAllowance.test.ts.
 */

describe("a single document may use at most a third of the month", () => {
  it("is 100 pages against the allowance actually being sold", () => {
    // Stated as a number once, because a rule nobody can read is a rule
    // nobody can argue with: 300 pages a month, 100 of them in one upload.
    expect(singleDocumentPageCeiling(ASK_MONTHLY_ALLOWANCE)).toBe(100);
  });

  it("follows the allowance rather than sitting beside it", () => {
    expect(singleDocumentPageCeiling({ questions: 300, pages: 900 })).toBe(300);
    expect(singleDocumentPageCeiling({ questions: 300, pages: 30 })).toBe(10);
    // And it is really the fraction doing the work, not a coincidence at
    // one value.
    expect(singleDocumentPageCeiling({ questions: 1, pages: 42 })).toBe(
      Math.floor(42 / SINGLE_DOCUMENT_ALLOWANCE_FRACTION),
    );
  });

  it("never refuses every document, however small the allowance gets", () => {
    // A ceiling of zero would refuse a one-page lien waiver and read as a
    // broken feature. One page is the floor.
    expect(singleDocumentPageCeiling({ questions: 1, pages: 2 })).toBe(1);
    expect(singleDocumentPageCeiling({ questions: 1, pages: 0 })).toBe(1);
  });
});
