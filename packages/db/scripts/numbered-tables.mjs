/**
 * Which table each sequence counter numbers, and how the two are joined.
 *
 * WHY IT LIVES IN packages/db AND NOT IN A TEST FILE. It was a const inside
 * `apps/web/lib/counterCensus.test.ts`, which was the right place while the
 * only consumer was a scan of `apps/web/lib`. It is not any more: the demo
 * seed (`seed-demo.mjs`) writes numbered rows too, it is plain `.mjs` run
 * under bare node, and it shipped invoices and change orders with no counter
 * rows at all — permanently dead "Create invoice" on every demo-seeded job.
 * Both the source census and the database test that proves the seed now need
 * this map, and neither can reasonably import a file full of `describe()`.
 *
 * NOTHING IN THE SCHEMA SAYS WHICH TABLE A COUNTER NUMBERS, so this is
 * declared rather than derived — `SafetyCaseCounter` numbers `SafetyIncident`
 * and no naming rule gets you there. Declaring it is safe because
 * `counterCensus.test.ts` pins these keys to the schema's own list of
 * `model *Counter`: a new counter FAILS the build until somebody writes down
 * what it numbers. The declaring is the review.
 *
 * Plain `.mjs` with a `.d.mts` sibling, the same arrangement as
 * `scratch-scope.mjs` and `connection-target.mjs`: the scripts here run under
 * bare node with no build step, and the tests want types.
 */

/**
 * @type {Record<string, {
 *   accessor: string,
 *   helper: string,
 *   counterAccessor: string,
 *   numberField: string,
 *   counterField: string,
 *   scope: "job" | "company",
 * }>}
 *
 * `accessor`        the Prisma delegate of the NUMBERED table
 * `helper`          the function that must issue that number in app code
 * `counterAccessor` the Prisma delegate of the counter row itself
 * `numberField`     the numbered column on the row
 * `counterField`    the high-water column on the counter
 * `scope`           what the counter is keyed on. Only `SafetyCaseCounter` is
 *                   company-scoped, deliberately: it is a high-water mark
 *                   across every job and across years, so it is never deleted
 *                   with a job and never checked per job (issue #148).
 */
export const NUMBERED_TABLES = {
  BackchargeCounter: {
    accessor: "backcharge",
    helper: "issueBackchargeNumber",
    counterAccessor: "backchargeCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  ChangeOrderCounter: {
    accessor: "changeOrder",
    helper: "issueChangeOrderNumber",
    counterAccessor: "changeOrderCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  CloseoutSubmissionCounter: {
    accessor: "closeoutSubmission",
    helper: "issueAttemptNumber",
    counterAccessor: "closeoutSubmissionCounter",
    numberField: "attempt",
    counterField: "lastAttempt",
    scope: "job",
  },
  ContractDocumentVersionCounter: {
    accessor: "contractDocument",
    helper: "issueContractDocumentVersion",
    counterAccessor: "contractDocumentVersionCounter",
    numberField: "versionNumber",
    counterField: "lastNumber",
    scope: "job",
  },
  // #289, added by #290 while the census was in review — the first counter
  // this map has ever been asked to admit, and it worked as designed: the
  // build went red on the merge naming exactly this model, rather than the
  // counter quietly sitting outside every assertion.
  EstimateVersionCounter: {
    accessor: "estimateVersion",
    helper: "issueEstimateVersionNumber",
    counterAccessor: "estimateVersionCounter",
    numberField: "versionNumber",
    counterField: "lastNumber",
    scope: "job",
  },
  InvoiceCounter: {
    accessor: "invoice",
    helper: "issueInvoiceNumber",
    counterAccessor: "invoiceCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  MaterialOrderCounter: {
    accessor: "materialOrder",
    helper: "issueOrderNumber",
    counterAccessor: "materialOrderCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  RfiCounter: {
    accessor: "rfi",
    helper: "issueRfiNumber",
    counterAccessor: "rfiCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  SafetyCaseCounter: {
    accessor: "safetyIncident",
    helper: "issueCaseNumber",
    counterAccessor: "safetyCaseCounter",
    numberField: "caseNumber",
    counterField: "lastCaseNumber",
    scope: "company",
  },
  SubmittalCounter: {
    accessor: "submittal",
    helper: "issueSubmittalNumber",
    counterAccessor: "submittalCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
  // The WH-347 payroll number, per job per certified-payroll week — the
  // form's "Payroll No." is sequential per project, and the DOL reads the
  // sequence for missing weeks, which is exactly the reissue-and-renumber
  // failure the counter rule exists to prevent.
  Wh347PayrollCounter: {
    accessor: "wh347PayrollNumber",
    helper: "issueWh347PayrollNumber",
    counterAccessor: "wh347PayrollCounter",
    numberField: "number",
    counterField: "lastNumber",
    scope: "job",
  },
};
