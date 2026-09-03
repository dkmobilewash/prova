"use client";

import { inputClass, labelClass } from "@/components/RfiFields";

export type ContactPersonDefaults = {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
};

/** Shared by create and edit so the two can't drift on field names. */
export function ContactPersonFields({ defaults }: { defaults: ContactPersonDefaults }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Name
          <input name="name" required defaultValue={defaults.name} className={inputClass} />
        </label>
        <label className={labelClass}>
          Title
          <input
            name="title"
            defaultValue={defaults.title ?? ""}
            placeholder="PM, estimator, owner's rep..."
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Email
          <input type="email" name="email" defaultValue={defaults.email ?? ""} className={inputClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input name="phone" defaultValue={defaults.phone ?? ""} className={inputClass} />
        </label>
      </div>
    </>
  );
}
