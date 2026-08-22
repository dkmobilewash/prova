import { createJob } from "@/lib/actions";

export default function NewJobPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">New job</h1>
      <form action={createJob} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Job name
          <input
            name="jobName"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Smith kitchen remodel"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Scope
          <textarea
            name="scope"
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Full kitchen remodel including cabinets, countertops, and flooring."
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Client name
          <input
            name="contactName"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="Jane Smith"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Client email
          <input
            name="contactEmail"
            type="email"
            className="rounded-md border border-slate-300 px-3 py-2"
            placeholder="jane@example.com"
          />
        </label>
        <button
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Create job
        </button>
      </form>
    </main>
  );
}
