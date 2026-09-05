/**
 * TWO COMPLETE TENANTS, for the isolation suite.
 *
 * WHY THIS EXISTS
 *
 * Prova has, for its whole life, run with exactly one company on it. Every
 * serious bug found in the week this was written was the same shape — code
 * written while only one tenant existed, correct by accident, and invisible
 * until a second one turned up:
 *
 *   - a relation `_count` on a GLOBAL reference table rendered every
 *     contractor's row counts as yours (#169);
 *   - `clean-scratch-data.mjs` scoped its deletes to
 *     `findFirst(orderBy: createdAt asc)` — "the company", of which there
 *     was only ever one (#170);
 *   - `assertSalesAccess` had never once executed against a company where
 *     its checks were false, because with a single account no browser can
 *     reach the failing branch.
 *
 * None of those is findable by typecheck, lint or build, and none is
 * findable by a browser click-through either — you cannot click as a second
 * contractor. They are only findable by a test that HAS a second
 * contractor. That is this file.
 *
 * WHAT IT GUARANTEES
 *
 * `createTwoTenants()` returns two structurally identical companies, A and
 * B, each with an owner, a member, a contact, a job and a representative
 * row in every major domain. Identical shape is the point: any assertion
 * you can write about A's view of its own data, you can write about B, and
 * the interesting question — does A's view contain any of B's rows — is
 * always askable.
 *
 * The two are deliberately NOT identical in their numbers. Tenant B's line
 * items carry different quantities and prices from tenant A's, so a total
 * that accidentally sums both tenants is a WRONG NUMBER rather than a
 * plausible one. A fixture where both tenants hold $1,000 would let a
 * leaking sum pass at $2,000 only if you happened to assert the exact
 * figure; with different numbers, every arithmetic assertion catches it.
 *
 * EVERY ROW IS STAMPED. Ids that are globally unique in the schema
 * (User.email, User.clerkId, UnionLocal's (parentInternational,
 * localNumber)) collide with whatever a previous run left behind, so each
 * call gets its own stamp. This is the same discipline
 * unionCompliance.dbtest.ts already applies for UnionLocal, generalised.
 *
 * CLEANUP. `destroyTenants` deletes in reverse dependency order and is
 * meant to be called from `afterAll`. It also removes the rows this fixture
 * creates in the GLOBAL tables (UnionLocal, CraftClassification,
 * FringeRateSchedule, ApprenticeRatioRule) — those carry no companyId, so
 * nothing else will ever clean them up, and left behind they accumulate
 * into exactly the cross-company noise these tests exist to detect.
 */

import { prisma } from "@prova/db";

/** UTC midnight, the only way dates are stored in this app. */
export const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

let sequence = 0;
function stamp() {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * One tenant's ids. Every field is an id you can hand to an action to ask
 * "does this company's guard actually stop me", which is the whole point of
 * naming all of them rather than returning the rows.
 */
export type Tenant = {
  label: string;
  stamp: string;
  companyId: string;
  ownerId: string;
  memberId: string;
  contactId: string;
  contactPersonId: string;
  contactInteractionId: string;
  jobId: string;
  secondJobId: string;
  lineItemId: string;
  secondLineItemId: string;
  costEntryId: string;
  changeOrderId: string;
  invoiceId: string;
  invoiceLineItemId: string;
  paymentId: string;
  retainageReleaseId: string;
  estimateVersionId: string;
  catalogEntryId: string;
  bidInvitationId: string;
  vendorId: string;
  vendorPriceQuoteId: string;
  materialOrderId: string;
  materialOrderDeliveryId: string;
  equipmentId: string;
  equipmentAssignmentId: string;
  safetyIncidentId: string;
  toolboxTalkId: string;
  rfiId: string;
  submittalId: string;
  submittalRevisionId: string;
  punchListItemId: string;
  fieldReportId: string;
  drawingSetId: string;
  drawingRevisionId: string;
  closeoutItemId: string;
  closeoutSubmissionId: string;
  warrantyPeriodId: string;
  warrantyServiceRequestId: string;
  backchargeId: string;
  complianceDocumentId: string;
  licenseId: string;
  insurancePolicyId: string;
  bondId: string;
  locationId: string;
  timeEntryId: string;
  dispatchSlipId: string;
  prevailingWageRuleSetId: string;
  prevailingWageDeterminationId: string;
  /** This tenant's OWN union local, which the other tenant holds no
   * agreement with. Use it to assert a local you have no agreement with
   * never appears. */
  unionLocalId: string;
  unionAgreementId: string;
  craftClassificationId: string;
  fringeRateScheduleId: string;
  apprenticeRatioRuleId: string;
  /** This tenant's rows under the SHARED local both tenants signed with.
   * These are the ones that make the global-reference-table leaks
   * observable — see the SharedUnion docstring. */
  sharedAgreementId: string;
  sharedFringeId: string;
  sharedRatioRuleId: string;
  sharedCraftTimeEntryIds: string[];
  sharedCraftLineItemId: string;
  sharedCraftCatalogEntryId: string;
  /** How many rows THIS tenant hangs off the shared craft classification:
   * time entries + one job line item + one catalog entry. This is the
   * number `loadUnionSetup`'s `usageCount` should report to this tenant,
   * and the number a global `_count` gets wrong. */
  sharedCraftUsageCount: number;
  apprenticeshipEnrollmentId: string;
  inviteId: string;
  /** The money numbers this tenant's fixture uses, so a test can assert an
   * exact total and have a leak from the other tenant break it. */
  money: { unitPrice: number; quantity: number; invoiceAmount: number; paymentAmount: number };
};

type TenantShape = {
  label: string;
  unitPrice: number;
  quantity: number;
  invoiceAmount: number;
  paymentAmount: number;
  hours: number;
  /** How many time entries this tenant hangs off the SHARED craft. The two
   * tenants differ so a count that pools both is a wrong number rather
   * than a coincidence. */
  sharedTimeEntries: number;
  /** This tenant's rate period on the SHARED craft.
   *
   * They do not overlap, and they cannot: the database carries an exclusion
   * constraint (`FringeRateSchedule_no_overlapping_rates`) forbidding two
   * overlapping rate ranges on one craft classification. That constraint is
   * doing real work here — it is what stops two contractors under the same
   * hall from both holding a live rate on the same classification.
   *
   * What it does NOT do is decide whose rate applies. The periods are
   * consecutive (A rates January, B rates February onward), so for the
   * fixture's August time entries it is tenant B's rate in force — for BOTH
   * tenants' remittances. */
  sharedRateFrom: string;
  sharedRateTo: string | null;
};

/** Deliberately different numbers per tenant — see the file docstring. */
const SHAPES: Record<"A" | "B", TenantShape> = {
  A: {
    label: "A",
    unitPrice: 100,
    quantity: 2,
    invoiceAmount: 500,
    paymentAmount: 200,
    hours: 8,
    sharedTimeEntries: 2,
    sharedRateFrom: "2026-01-01",
    sharedRateTo: "2026-01-31",
  },
  B: {
    label: "B",
    unitPrice: 7,
    quantity: 3,
    invoiceAmount: 41,
    paymentAmount: 13,
    hours: 5,
    sharedTimeEntries: 1,
    sharedRateFrom: "2026-02-01",
    sharedRateTo: null,
  },
};

async function createTenant(
  shape: TenantShape,
  sharedLocalId: string,
  sharedCraftId: string,
): Promise<Tenant> {
  const s = stamp();
  const n = `t${shape.label}${s}`;

  const company = await prisma.company.create({
    data: { name: `Isolation ${shape.label} ${s}` },
  });

  const owner = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `clerk_owner_${n}`,
      email: `owner_${n}@example.test`,
      name: `Owner ${shape.label}`,
      role: "OWNER",
    },
  });
  const member = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `clerk_member_${n}`,
      email: `member_${n}@example.test`,
      name: `Member ${shape.label}`,
      role: "MEMBER",
    },
  });

  const invite = await prisma.invite.create({
    data: { companyId: company.id, email: `invitee_${n}@example.test` },
  });

  const location = await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      locationType: "HQ",
      name: `Yard ${shape.label}`,
      addressLine1: `${shape.label} Main St`,
      city: "Oakland",
      state: "CA",
      zip: "94601",
    },
  });

  const contact = await prisma.contact.create({
    data: {
      companyId: company.id,
      name: `GC ${shape.label} ${s}`,
      email: `gc_${n}@example.test`,
      defaultRetainagePercent: "10",
    },
  });
  const contactPerson = await prisma.contactPerson.create({
    data: { companyId: company.id, contactId: contact.id, name: `Person ${shape.label}` },
  });
  const contactInteraction = await prisma.contactInteraction.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      contactPersonId: contactPerson.id,
      type: "CALL",
      occurredOn: utc("2026-08-01"),
      summary: `Call with ${shape.label}`,
      // A due follow-up, so this tenant has an alert of its own in
      // loadAlerts and the two tenants' alert lists are both non-empty.
      followUpOn: utc("2026-08-10"),
      followUpAssignedToUserId: member.id,
    },
  });

  // --- global union reference rows, stamped so two runs never collide ---
  const unionLocal = await prisma.unionLocal.create({
    data: {
      parentInternational: `Carpenters ${shape.label}`,
      localNumber: n,
      jurisdictionName: "Northern California",
    },
  });
  const unionAgreement = await prisma.companyUnionAgreement.create({
    data: {
      companyId: company.id,
      unionLocalId: unionLocal.id,
      effectiveFrom: utc("2026-01-01"),
    },
  });
  const craft = await prisma.craftClassification.create({
    data: { unionLocalId: unionLocal.id, name: `Journeyman ${shape.label}`, tier: "JOURNEYMAN" },
  });
  const fringe = await prisma.fringeRateSchedule.create({
    data: {
      craftClassificationId: craft.id,
      baseWage: "45",
      pensionRate: "8",
      vacationRate: "3",
      healthWelfareRate: "11",
      trainingRate: "1",
      effectiveFrom: utc("2026-01-01"),
    },
  });
  const ratioRule = await prisma.apprenticeRatioRule.create({
    data: { unionLocalId: unionLocal.id, apprenticeCount: 1, journeymenCount: 3 },
  });

  // --- the SHARED local: both tenants hold an agreement with this one ---
  //
  // This is the configuration in which the global-table exposures are
  // observable at all. UnionLocal, CraftClassification, FringeRateSchedule
  // and ApprenticeRatioRule carry no companyId, and the access check
  // everywhere is "does this company hold an agreement with the local".
  // Two companies signing the same hall is the ordinary case in this trade
  // — and it is the case under which one tenant's rates, ratio rules and
  // record counts become visible to the other. A fixture where each tenant
  // has only its own local passes every union assertion and proves nothing.
  const sharedAgreement = await prisma.companyUnionAgreement.create({
    data: {
      companyId: company.id,
      unionLocalId: sharedLocalId,
      effectiveFrom: utc("2026-01-01"),
    },
  });
  // BOTH tenants write a rate schedule against the SAME craft. Only one can
  // be "in force" by effective date, so whichever is later prices both
  // tenants' remittances — including the tenant that never agreed to it.
  const sharedFringe = await prisma.fringeRateSchedule.create({
    data: {
      craftClassificationId: sharedCraftId,
      baseWage: String(shape.unitPrice),
      pensionRate: String(shape.quantity),
      vacationRate: "1",
      healthWelfareRate: "1",
      trainingRate: "1",
      effectiveFrom: utc(shape.sharedRateFrom),
      effectiveTo: shape.sharedRateTo ? utc(shape.sharedRateTo) : null,
    },
  });
  const sharedRatioRule = await prisma.apprenticeRatioRule.create({
    data: {
      unionLocalId: sharedLocalId,
      apprenticeCount: shape.quantity,
      journeymenCount: shape.quantity + 1,
      programStandardReference: `Standard ${shape.label} ${s}`,
    },
  });

  const enrollment = await prisma.apprenticeshipEnrollment.create({
    data: {
      companyId: company.id,
      apprenticeUserId: member.id,
      sponsorName: `Sponsor ${shape.label}`,
      craftClassificationId: craft.id,
      unionLocalId: unionLocal.id,
      enrolledOn: utc("2026-02-01"),
    },
  });

  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: `Job ${shape.label} ${s}`,
      status: "IN_PROGRESS",
      operatingLocationId: location.id,
      retainagePercent: "10",
      substantialCompletionDate: utc("2026-12-01"),
      startDate: utc("2026-03-01"),
    },
  });
  const secondJob = await prisma.job.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      name: `Second job ${shape.label} ${s}`,
      status: "ESTIMATE",
    },
  });
  await prisma.jobAssignment.create({ data: { jobId: job.id, userId: member.id } });

  const lineItem = await prisma.jobLineItem.create({
    data: {
      jobId: job.id,
      description: `Framing ${shape.label}`,
      quantity: String(shape.quantity),
      unit: "SF",
      unitPrice: String(shape.unitPrice),
      budgetedUnitCost: String(shape.unitPrice / 2),
      currentEstimatedUnitCost: String(shape.unitPrice / 2),
      laborHours: "10",
      craftClassificationId: craft.id,
      sortOrder: 0,
    },
  });
  const secondLineItem = await prisma.jobLineItem.create({
    data: {
      jobId: job.id,
      description: `Drywall ${shape.label}`,
      quantity: String(shape.quantity),
      unit: "SF",
      unitPrice: String(shape.unitPrice),
      budgetedUnitCost: String(shape.unitPrice / 2),
      sortOrder: 1,
    },
  });
  const costEntry = await prisma.costEntry.create({
    data: {
      lineItemId: lineItem.id,
      description: `Cost ${shape.label}`,
      amount: String(shape.unitPrice),
      category: "LABOR",
      incurredAt: utc("2026-08-10"),
    },
  });

  const changeOrder = await prisma.changeOrder.create({
    data: { jobId: job.id, number: 1, title: `CO ${shape.label}`, status: "DRAFT" },
  });
  await prisma.changeOrderCounter.create({ data: { jobId: job.id, lastNumber: 1 } });

  const invoice = await prisma.invoice.create({
    data: {
      jobId: job.id,
      number: 1,
      description: `Invoice ${shape.label}`,
      amount: String(shape.invoiceAmount),
      issuedAt: utc("2026-08-01"),
      dueAt: utc("2026-09-01"),
      status: "SUBMITTED",
      retainageWithheld: "10",
    },
  });
  const invoiceLineItem = await prisma.invoiceLineItem.create({
    data: {
      invoiceId: invoice.id,
      lineItemId: lineItem.id,
      thisPeriodBilled: String(shape.invoiceAmount),
      materialsStoredValue: "0",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      amount: String(shape.paymentAmount),
      method: "CHECK",
      receivedAt: utc("2026-08-15"),
    },
  });
  const retainageRelease = await prisma.retainageRelease.create({
    data: { jobId: job.id, amount: "25", releasedAt: utc("2026-08-20") },
  });
  const estimateVersion = await prisma.estimateVersion.create({
    data: { jobId: job.id, versionNumber: 1, snapshot: [{ description: `snap ${shape.label}` }] },
  });

  const catalogEntry = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: `Catalog ${shape.label}`,
      unit: "SF",
      defaultUnitPrice: String(shape.unitPrice),
      craftClassificationId: craft.id,
    },
  });
  const bidInvitation = await prisma.bidInvitation.create({
    data: {
      companyId: company.id,
      contactId: contact.id,
      projectName: `Bid ${shape.label}`,
      status: "INVITED",
      bidAmount: String(shape.invoiceAmount),
      dueDate: utc("2026-10-01"),
    },
  });

  const vendor = await prisma.vendor.create({
    data: { companyId: company.id, name: `Vendor ${shape.label} ${s}` },
  });
  const vendorPriceQuote = await prisma.vendorPriceQuote.create({
    data: {
      companyId: company.id,
      vendorId: vendor.id,
      catalogEntryId: catalogEntry.id,
      description: `Quote ${shape.label}`,
      unitPrice: String(shape.unitPrice),
      quotedOn: utc("2026-07-01"),
    },
  });
  const materialOrder = await prisma.materialOrder.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      number: 1,
      vendorId: vendor.id,
      lineItemId: lineItem.id,
      description: `Order ${shape.label}`,
      orderedOn: utc("2026-07-05"),
      promisedFor: utc("2026-07-20"),
    },
  });
  await prisma.materialOrderCounter.create({ data: { jobId: job.id, lastNumber: 1 } });
  const materialOrderDelivery = await prisma.materialOrderDelivery.create({
    data: { orderId: materialOrder.id, deliveredOn: utc("2026-07-18"), completesOrder: false },
  });

  const equipment = await prisma.equipment.create({
    data: { companyId: company.id, name: `Lift ${shape.label}`, type: "SCISSOR_LIFT" },
  });
  const equipmentAssignment = await prisma.equipmentAssignment.create({
    data: {
      companyId: company.id,
      equipmentId: equipment.id,
      jobId: job.id,
      sentOutOn: utc("2026-06-01"),
    },
  });

  const safetyIncident = await prisma.safetyIncident.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      caseNumber: 1,
      caseYear: 2026,
      occurredAt: utc("2026-05-01"),
      employeeName: `Worker ${shape.label}`,
      description: `Incident ${shape.label}`,
      classification: "INJURY",
      outcome: "DAYS_AWAY",
      daysAway: 3,
    },
  });
  await prisma.safetyCaseCounter.create({
    data: { companyId: company.id, caseYear: 2026, lastCaseNumber: 1 },
  });
  const toolboxTalk = await prisma.toolboxTalk.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      heldOn: utc("2026-05-02"),
      topic: `Ladders ${shape.label}`,
    },
  });

  const rfi = await prisma.rfi.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      number: 1,
      subject: `RFI ${shape.label}`,
      question: `Question ${shape.label}`,
      status: "SENT",
      sentOn: utc("2026-04-01"),
      dueBy: utc("2026-04-08"),
    },
  });
  await prisma.rfiCounter.create({ data: { jobId: job.id, lastNumber: 1 } });

  const submittal = await prisma.submittal.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      number: 1,
      title: `Submittal ${shape.label}`,
      lastRevision: 1,
    },
  });
  const submittalRevision = await prisma.submittalRevision.create({
    data: {
      submittalId: submittal.id,
      revisionNumber: 1,
      sentOn: utc("2026-04-10"),
      dueBack: utc("2026-04-24"),
    },
  });
  await prisma.submittalCounter.create({ data: { jobId: job.id, lastNumber: 1 } });

  const punchListItem = await prisma.punchListItem.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      description: `Punch ${shape.label}`,
      raisedByUserId: member.id,
    },
  });
  const fieldReport = await prisma.dailyFieldReport.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      reportDate: utc("2026-08-03"),
      workPerformed: `Work ${shape.label}`,
      crewPresent: "3",
    },
  });

  const drawingSet = await prisma.drawingSet.create({
    data: { companyId: company.id, jobId: job.id, name: `Architectural ${shape.label}` },
  });
  const drawingRevision = await prisma.drawingRevision.create({
    data: { setId: drawingSet.id, label: "Rev A", issuedOn: utc("2026-03-15") },
  });

  const closeoutItem = await prisma.closeoutItem.create({
    data: { companyId: company.id, jobId: job.id, name: `O&M manuals ${shape.label}` },
  });
  const closeoutSubmission = await prisma.closeoutSubmission.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      attempt: 1,
      submittedOn: utc("2026-11-01"),
      status: "SUBMITTED",
    },
  });
  await prisma.closeoutSubmissionCounter.create({ data: { jobId: job.id, lastAttempt: 1 } });
  const warrantyPeriod = await prisma.warrantyPeriod.create({
    data: { companyId: company.id, jobId: job.id, startsOn: utc("2026-12-01"), months: 12 },
  });
  const warrantyServiceRequest = await prisma.warrantyServiceRequest.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      reportedOn: utc("2027-01-05"),
      description: `Callback ${shape.label}`,
    },
  });

  const backcharge = await prisma.backcharge.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      number: 1,
      description: `Backcharge ${shape.label}`,
      claimedAmount: String(shape.invoiceAmount),
      issuedOn: utc("2026-08-05"),
      status: "RECEIVED",
    },
  });
  await prisma.backchargeCounter.create({ data: { jobId: job.id, lastNumber: 1 } });

  const complianceDocument = await prisma.complianceDocument.create({
    data: {
      companyId: company.id,
      jobId: job.id,
      type: "LIEN_WAIVER",
      partyName: `Party ${shape.label}`,
      status: "PENDING",
      expiresAt: utc("2026-10-01"),
    },
  });
  const license = await prisma.companyLicense.create({
    data: {
      companyId: company.id,
      jurisdictionType: "STATE",
      jurisdictionName: "California",
      licenseNumber: `LIC-${n}`,
      status: "ACTIVE",
      expirationDate: utc("2026-11-01"),
    },
  });
  const insurancePolicy = await prisma.companyInsurancePolicy.create({
    data: {
      companyId: company.id,
      policyType: "GENERAL_LIABILITY",
      carrier: `Carrier ${shape.label}`,
      policyNumber: `POL-${n}`,
      expirationDate: utc("2026-10-15"),
    },
  });
  const bond = await prisma.companyBond.create({
    data: {
      companyId: company.id,
      suretyName: `Surety ${shape.label}`,
      bondType: "LICENSE_BOND",
      renewalDate: utc("2026-12-15"),
    },
  });

  const timeEntry = await prisma.timeEntry.create({
    data: {
      jobId: job.id,
      lineItemId: lineItem.id,
      employeeUserId: member.id,
      craftClassificationId: craft.id,
      date: utc("2026-08-17"),
      hours: String(shape.hours),
      payType: "STRAIGHT",
    },
  });
  // Rows hung off the SHARED craft classification. Both tenants tag work
  // against the same classification — the ordinary case when two
  // contractors work under one hall — and the counts differ between them,
  // so a `_count` that pools both tenants reports a number neither tenant's
  // own records justify. This is the #169 shape.
  const sharedCraftTimeEntryIds: string[] = [];
  for (let i = 0; i < shape.sharedTimeEntries; i += 1) {
    const entry = await prisma.timeEntry.create({
      data: {
        jobId: job.id,
        employeeUserId: member.id,
        craftClassificationId: sharedCraftId,
        date: utc(`2026-08-1${8 + i}`),
        hours: String(shape.hours),
        payType: "STRAIGHT",
      },
    });
    sharedCraftTimeEntryIds.push(entry.id);
  }
  const sharedCraftLineItem = await prisma.jobLineItem.create({
    data: {
      jobId: job.id,
      description: `Shared craft work ${shape.label}`,
      quantity: String(shape.quantity),
      unitPrice: String(shape.unitPrice),
      craftClassificationId: sharedCraftId,
      sortOrder: 2,
    },
  });
  const sharedCraftCatalogEntry = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId: company.id,
      description: `Shared craft catalog ${shape.label}`,
      craftClassificationId: sharedCraftId,
    },
  });

  const dispatchSlip = await prisma.dispatchSlip.create({
    data: {
      jobId: job.id,
      employeeUserId: member.id,
      craftClassificationId: craft.id,
      dispatchDate: utc("2026-08-16"),
    },
  });

  const prevailingWageRuleSet = await prisma.prevailingWageRuleSet.create({
    data: {
      companyId: company.id,
      name: `Rules ${shape.label}`,
      jurisdiction: "California",
      authority: "STATE",
      effectiveFrom: utc("2026-01-01"),
      dailyOvertimeAfterHours: "8",
    },
  });
  const prevailingWageDetermination = await prisma.prevailingWageDetermination.create({
    data: { jobId: job.id, jurisdiction: "California", ruleSetId: prevailingWageRuleSet.id },
  });

  return {
    label: shape.label,
    stamp: s,
    companyId: company.id,
    ownerId: owner.id,
    memberId: member.id,
    contactId: contact.id,
    contactPersonId: contactPerson.id,
    contactInteractionId: contactInteraction.id,
    jobId: job.id,
    secondJobId: secondJob.id,
    lineItemId: lineItem.id,
    secondLineItemId: secondLineItem.id,
    costEntryId: costEntry.id,
    changeOrderId: changeOrder.id,
    invoiceId: invoice.id,
    invoiceLineItemId: invoiceLineItem.id,
    paymentId: payment.id,
    retainageReleaseId: retainageRelease.id,
    estimateVersionId: estimateVersion.id,
    catalogEntryId: catalogEntry.id,
    bidInvitationId: bidInvitation.id,
    vendorId: vendor.id,
    vendorPriceQuoteId: vendorPriceQuote.id,
    materialOrderId: materialOrder.id,
    materialOrderDeliveryId: materialOrderDelivery.id,
    equipmentId: equipment.id,
    equipmentAssignmentId: equipmentAssignment.id,
    safetyIncidentId: safetyIncident.id,
    toolboxTalkId: toolboxTalk.id,
    rfiId: rfi.id,
    submittalId: submittal.id,
    submittalRevisionId: submittalRevision.id,
    punchListItemId: punchListItem.id,
    fieldReportId: fieldReport.id,
    drawingSetId: drawingSet.id,
    drawingRevisionId: drawingRevision.id,
    closeoutItemId: closeoutItem.id,
    closeoutSubmissionId: closeoutSubmission.id,
    warrantyPeriodId: warrantyPeriod.id,
    warrantyServiceRequestId: warrantyServiceRequest.id,
    backchargeId: backcharge.id,
    complianceDocumentId: complianceDocument.id,
    licenseId: license.id,
    insurancePolicyId: insurancePolicy.id,
    bondId: bond.id,
    locationId: location.id,
    timeEntryId: timeEntry.id,
    dispatchSlipId: dispatchSlip.id,
    prevailingWageRuleSetId: prevailingWageRuleSet.id,
    prevailingWageDeterminationId: prevailingWageDetermination.id,
    unionLocalId: unionLocal.id,
    unionAgreementId: unionAgreement.id,
    craftClassificationId: craft.id,
    fringeRateScheduleId: fringe.id,
    apprenticeRatioRuleId: ratioRule.id,
    sharedAgreementId: sharedAgreement.id,
    sharedFringeId: sharedFringe.id,
    sharedRatioRuleId: sharedRatioRule.id,
    sharedCraftTimeEntryIds,
    sharedCraftLineItemId: sharedCraftLineItem.id,
    sharedCraftCatalogEntryId: sharedCraftCatalogEntry.id,
    // time entries + the one line item + the one catalog entry
    sharedCraftUsageCount: shape.sharedTimeEntries + 2,
    apprenticeshipEnrollmentId: enrollment.id,
    inviteId: invite.id,
    money: {
      unitPrice: shape.unitPrice,
      quantity: shape.quantity,
      invoiceAmount: shape.invoiceAmount,
      paymentAmount: shape.paymentAmount,
    },
  };
}

/**
 * The one union local BOTH tenants hold an agreement with.
 *
 * Two contractors signing the same hall is the ordinary case in this
 * trade, and it is the only configuration in which the global union
 * reference tables can leak one tenant's data into the other's view. Every
 * union assertion in the suite runs against this local.
 */
export type SharedUnion = {
  localId: string;
  localNumber: string;
  /** ONE craft classification under the shared local, which BOTH tenants
   * tag work against. Global `_count`s and rate lookups on this row are
   * where one tenant's records reach the other's screen. */
  craftId: string;
};

export type TwoTenants = { a: Tenant; b: Tenant; shared: SharedUnion };

/**
 * Build tenant A and tenant B. Sequential rather than concurrent: these
 * share a database and the counter rows are keyed per job, so racing the
 * two builds would produce failures about the fixture rather than the code.
 */
export async function createTwoTenants(): Promise<TwoTenants> {
  const localNumber = `shared${stamp()}`;
  const sharedLocal = await prisma.unionLocal.create({
    data: {
      parentInternational: `Carpenters SHARED ${localNumber}`,
      localNumber,
      jurisdictionName: "Northern California",
    },
  });
  const sharedCraft = await prisma.craftClassification.create({
    data: {
      unionLocalId: sharedLocal.id,
      name: `Shared journeyman ${localNumber}`,
      tier: "JOURNEYMAN",
    },
  });
  const a = await createTenant(SHAPES.A, sharedLocal.id, sharedCraft.id);
  const b = await createTenant(SHAPES.B, sharedLocal.id, sharedCraft.id);
  return {
    a,
    b,
    shared: { localId: sharedLocal.id, localNumber, craftId: sharedCraft.id },
  };
}

/**
 * Delete everything `createTwoTenants` made, children before parents.
 *
 * Written as an explicit ordered list rather than anything clever. A
 * cleanup that guesses its own order is the `clean-scratch-data.mjs` bug
 * (#170) in a different costume, and this one runs on every CI job.
 */
export async function destroyTenants(tenants: TwoTenants): Promise<void> {
  const list = [tenants.a, tenants.b];
  const companyIds = list.map((t) => t.companyId);
  const jobIds = list.flatMap((t) => [t.jobId, t.secondJobId]);
  const localIds = [...list.map((t) => t.unionLocalId), tenants.shared.localId];
  const userIds = list.flatMap((t) => [t.ownerId, t.memberId]);
  const vendorIds = list.map((t) => t.vendorId);

  // Money and its children first — Payment -> Invoice -> Job.
  await prisma.payment.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId: { in: jobIds } } } });
  await prisma.invoice.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.retainageRelease.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.contractDocument.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.signatureRequest.deleteMany({ where: { jobId: { in: jobIds } } });

  // Anything pointing at a JobLineItem, before the line items themselves.
  await prisma.costEntry.deleteMany({ where: { lineItem: { jobId: { in: jobIds } } } });
  await prisma.timeEntry.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.dispatchSlip.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.materialOrderDelivery.deleteMany({
    where: { order: { jobId: { in: jobIds } } },
  });
  await prisma.materialOrder.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.materialOrderCounter.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.changeOrderLineItemEdit.deleteMany({
    where: { changeOrder: { jobId: { in: jobIds } } },
  });
  await prisma.changeOrderProposal.deleteMany({
    where: { changeOrder: { jobId: { in: jobIds } } },
  });
  await prisma.changeOrder.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.changeOrderCounter.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.estimateVersion.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.prevailingWageDetermination.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.prevailingWageRuleSet.deleteMany({ where: { companyId: { in: companyIds } } });

  await prisma.vendorPriceQuote.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });

  await prisma.equipmentAssignment.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.equipment.deleteMany({ where: { companyId: { in: companyIds } } });

  await prisma.drawingRevision.deleteMany({ where: { set: { jobId: { in: jobIds } } } });
  await prisma.drawingSet.deleteMany({ where: { jobId: { in: jobIds } } });

  await prisma.submittalRevision.deleteMany({
    where: { submittal: { jobId: { in: jobIds } } },
  });
  await prisma.submittal.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.submittalCounter.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.rfi.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.rfiCounter.deleteMany({ where: { jobId: { in: jobIds } } });

  await prisma.safetyIncident.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.safetyCaseCounter.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.toolboxTalk.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.punchListItem.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.dailyFieldReport.deleteMany({ where: { companyId: { in: companyIds } } });

  await prisma.closeoutSubmission.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.closeoutSubmissionCounter.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.closeoutItem.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.warrantyServiceRequest.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.warrantyPeriod.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.backcharge.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.backchargeCounter.deleteMany({ where: { jobId: { in: jobIds } } });

  await prisma.apprenticeshipPeriodRecord.deleteMany({
    where: { enrollment: { companyId: { in: companyIds } } },
  });
  await prisma.apprenticeshipEnrollment.deleteMany({ where: { companyId: { in: companyIds } } });

  await prisma.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });

  await prisma.bidInvitation.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.contactInteraction.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.contactPerson.deleteMany({ where: { companyId: { in: companyIds } } });

  // CompanyUnionAgreement points at ComplianceDocument, so it goes first.
  await prisma.companyUnionAgreement.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.complianceDocument.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.companyLicense.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.companyInsurancePolicy.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.companyBond.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.companyTradeScope.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.companyLocation.deleteMany({ where: { companyId: { in: companyIds } } });

  await prisma.alertAcknowledgement.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.notificationDispatch.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.invite.deleteMany({ where: { companyId: { in: companyIds } } });

  // The GLOBAL union rows this fixture created. Nothing else cleans these
  // up — they carry no companyId — and left behind they become exactly the
  // cross-company noise this suite exists to detect.
  await prisma.fringeRateSchedule.deleteMany({
    where: { craftClassification: { unionLocalId: { in: localIds } } },
  });
  await prisma.apprenticeRatioRule.deleteMany({ where: { unionLocalId: { in: localIds } } });
  await prisma.craftClassification.deleteMany({ where: { unionLocalId: { in: localIds } } });
  await prisma.unionLocal.deleteMany({ where: { id: { in: localIds } } });

  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
}
