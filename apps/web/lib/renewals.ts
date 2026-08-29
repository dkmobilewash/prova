import { prisma } from "@prova/db";
import { toIsoDate, type RenewalSource } from "@/lib/compliance-expiry";

/**
 * Collects everything in one company that can lapse.
 *
 * Four models, four different date column names, four different pages —
 * which is exactly why nobody could see the whole picture before. The
 * ranking itself is a pure function in compliance-expiry.ts; this only
 * fetches and normalises.
 *
 * Each query is narrowed to the rows that could possibly matter, so the
 * page cost does not grow with a company's filing history: a compliance
 * document only expires if it is a COI, and everything else is filtered by
 * having a date at all or being a kind where a missing date is a gap.
 */

const TYPE_LABELS: Record<string, string> = {
  LIEN_WAIVER: "Lien waiver",
  CERTIFICATE_OF_INSURANCE: "Certificate of insurance",
  CERTIFIED_PAYROLL: "Certified payroll",
  UNION_FRINGE_BENEFIT_FILING: "Union fringe/benefit filing",
  UNION_AGREEMENT: "Union agreement",
};

const POLICY_LABELS: Record<string, string> = {
  GENERAL_LIABILITY: "General liability",
  WORKERS_COMP: "Workers' comp",
  AUTO: "Auto",
  UMBRELLA_EXCESS: "Umbrella / excess",
};

const BOND_LABELS: Record<string, string> = {
  LICENSE_BOND: "Licence bond",
  PERFORMANCE_PAYMENT_CAPACITY: "Performance & payment capacity",
};

export async function renewalSourcesForCompany(companyId: string): Promise<RenewalSource[]> {
  const [documents, licenses, policies, bonds] = await Promise.all([
    // Only COIs expire. A lien waiver or a payroll report has no renewal
    // date and never will, so they are not candidates at all.
    prisma.complianceDocument.findMany({
      where: { companyId, type: "CERTIFICATE_OF_INSURANCE" },
      select: { id: true, type: true, partyName: true, expiresAt: true },
    }),
    prisma.companyLicense.findMany({
      where: { companyId },
      select: {
        id: true,
        jurisdictionName: true,
        licenseNumber: true,
        expirationDate: true,
        status: true,
      },
    }),
    prisma.companyInsurancePolicy.findMany({
      where: { companyId },
      select: { id: true, policyType: true, carrier: true, expirationDate: true },
    }),
    prisma.companyBond.findMany({
      where: { companyId },
      select: { id: true, suretyName: true, bondType: true, renewalDate: true },
    }),
  ]);

  return [
    ...documents.map((doc): RenewalSource => ({
      id: doc.id,
      kind: "COMPLIANCE_DOCUMENT",
      title: TYPE_LABELS[doc.type] ?? doc.type,
      detail: doc.partyName,
      date: toIsoDate(doc.expiresAt),
      expectsDate: true,
      href: "/compliance",
    })),
    ...licenses.map((license): RenewalSource => ({
      id: license.id,
      kind: "LICENSE",
      title: `Licence ${license.licenseNumber}`,
      detail: license.jurisdictionName,
      date: toIsoDate(license.expirationDate),
      expectsDate: true,
      href: "/settings",
      // The only one of the four that stores a status about itself, and so
      // the only one that can contradict its own date.
      storedStatus: license.status,
    })),
    ...policies.map((policy): RenewalSource => ({
      id: policy.id,
      kind: "INSURANCE_POLICY",
      title: POLICY_LABELS[policy.policyType] ?? policy.policyType,
      detail: policy.carrier,
      date: toIsoDate(policy.expirationDate),
      expectsDate: true,
      href: "/settings",
    })),
    ...bonds.map((bond): RenewalSource => ({
      id: bond.id,
      kind: "BOND",
      title: BOND_LABELS[bond.bondType] ?? bond.bondType,
      detail: bond.suretyName,
      date: toIsoDate(bond.renewalDate),
      // A bond's renewal date is optional in the schema and a company may
      // legitimately hold one with no scheduled renewal, so a missing date
      // here is not automatically a gap to chase.
      expectsDate: false,
      href: "/settings",
    })),
  ];
}
