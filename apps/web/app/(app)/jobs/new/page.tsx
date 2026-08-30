import { createJob } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold text-slate-100">New job</h1>
      <form action={createJob} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Job name
          <input
            name="jobName"
            required
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            placeholder="Smith kitchen remodel"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Scope
          <textarea
            name="scope"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            placeholder="Full kitchen remodel including cabinets, countertops, and flooring."
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Client name
          <input
            name="contactName"
            required
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            placeholder="Jane Smith"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Client email
          <input
            name="contactEmail"
            type="email"
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            placeholder="jane@example.com"
          />
        </label>
        <SubmitButton
          type="submit"
          className="mt-2 inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Create job
        </SubmitButton>
      </form>
    </div>
  );
}
