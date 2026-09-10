import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { ContractSummary } from "@/components/ContractSummary";
import { signRequest } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { viewerTimeZone } from "@/lib/viewerToday";
import { isSignatureLinkDead } from "@/lib/access-tokens";
import { formatSignedDate } from "@/lib/signed-date";

type Snapshot = {
  companyName: string;
  jobName: string;
  clientName: string;
  scope: string | null;
  total: number;
  lineItems: { description: string; quantity: string; unit: string | null; unitPrice: string | null }[];
};

export default async function EsignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: {
      job: {
        include: {
          company: true,
          contact: true,
          lineItems: {
            where: { isDeleted: false },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  // Issue #106 finding 2: a REVOKED or EXPIRED PENDING request 404s
  // exactly like a token that never existed, matching the portal's
  // "wrong jobId 404s" convention rather than telling whoever holds a
  // dead link that it once worked. Checked only while PENDING — a SIGNED
  // request only ever renders its own frozen `snapshot` below, never live
  // job data, so there is nothing left for revocation or expiry to
  // protect and a signed contract stays a readable evidence record
  // regardless (CLAUDE.md: sent correspondence can close but never
  // delete).
  if (!request) {
    notFound();
  }
  if (isSignatureLinkDead(request, new Date())) {
    notFound();
  }

  const signRequestWithToken = signRequest.bind(null, token);

  if (request.status === "SIGNED") {
    const snapshot = request.snapshot as unknown as Snapshot;
    // Issue #106 finding 7: rendered in the SIGNER's zone, not the
    // server's. There is no TimeZoneCookie on this route (it only mounts
    // in the signed-in (app) layout, and there is no signed-in session
    // here to mount it into) so this falls back to Vercel's geo-IP header
    // in production, or the honest UTC floor otherwise — see
    // viewerTimeZone's own comment for the full fallback order. Either is
    // strictly better than the server's own clock, which is what rendered
    // an evening signature west of UTC a day late on the one date a
    // dispute turns on.
    const timeZone = await viewerTimeZone();
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">
          Signed by {request.signerName} on{" "}
          {request.signedAt && formatSignedDate(request.signedAt, timeZone)}
          . This reflects exactly what was agreed to at the time of signing.
        </div>
        <ContractSummary
          companyName={snapshot.companyName}
          jobName={snapshot.jobName}
          // The client signing does not contract the job -- markJobContracted
          // is still a separate, deliberate step by the contractor. Showing
          // "Contracted" here claimed something that hadn't happened, and
          // disagreed with the job page, which still read "Estimate".
          status="SIGNED"
          clientName={snapshot.clientName}
          scope={snapshot.scope}
          lineItems={snapshot.lineItems.map((item, i) => ({
            id: String(i),
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            changeOrderNumber: null,
          }))}
          // Issue #106 finding 6: this IS the frozen snapshot the banner
          // above already says it is — ContractSummary's default footer
          // claims "the CURRENT agreed scope and pricing", which
          // contradicted the banner four lines up on the same page. See
          // ContractSummary's `frozen` prop.
          frozen
        />
      </main>
    );
  }

  const { job } = request;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <ContractSummary
        companyName={job.company.name}
        jobName={job.name}
        status={job.status}
        clientName={job.contact.name}
        scope={job.scope}
        lineItems={job.lineItems.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unit: item.unit,
          unitPrice: item.unitPrice?.toString() ?? null,
          changeOrderNumber: null,
        }))}
      />

      <form
        action={signRequestWithToken}
        className="mt-6 flex flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-slate-100">Sign to accept</h2>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Your full name
          <input
            name="signerName"
            required
            defaultValue={job.contact.name}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Email (optional)
          <input
            name="signerEmail"
            type="email"
            defaultValue={job.contact.email ?? ""}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input type="checkbox" name="agree" required className="mt-1" />
          <span>
            I have reviewed the scope and pricing above and agree that typing my name and submitting
            this form constitutes my legal signature accepting this contract.
          </span>
        </label>
        {/* Issue #106 finding 8: was a bare `<button>`, clickable for the
            whole round trip. A second click before the first request
            returned re-submitted the form; the server side of that race
            is closed in `signRequest` itself (an idempotent `updateMany`
            keyed on still-PENDING), and this closes the client side the
            same way every create button in this app already does. */}
        <SubmitButton
          type="submit"
          className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Sign contract
        </SubmitButton>
      </form>
    </main>
  );
}
