import { notFound } from "next/navigation";
import { prisma } from "@prova/db";
import { ContractSummary } from "@/components/ContractSummary";
import { signRequest } from "@/lib/actions";

type Snapshot = {
  companyName: string;
  jobName: string;
  clientName: string;
  scope: string | null;
  total: number;
  lineItems: { description: string; quantity: string; unit: string | null; unitPrice: string }[];
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

  if (!request) {
    notFound();
  }

  const signRequestWithToken = signRequest.bind(null, token);

  if (request.status === "SIGNED") {
    const snapshot = request.snapshot as unknown as Snapshot;
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">
          Signed by {request.signerName} on{" "}
          {request.signedAt?.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          . This reflects exactly what was agreed to at the time of signing.
        </div>
        <ContractSummary
          companyName={snapshot.companyName}
          jobName={snapshot.jobName}
          status="CONTRACTED"
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
          unitPrice: item.unitPrice.toString(),
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
        <button
          type="submit"
          className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Sign contract
        </button>
      </form>
    </main>
  );
}
