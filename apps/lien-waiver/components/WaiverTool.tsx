"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { forgetEverything, loadContact, loadFields, saveContact, saveFields, type Contact } from "@/lib/browser-memory";
import { FINAL_WARNING, FORM_MEANINGS, FORM_NAMES, UNCONDITIONAL_WARNING } from "@/lib/content";
import { checkFills } from "@/lib/fills";
import { getForm, slotsAsked } from "@/lib/statutes/forms";
import { SLOTS } from "@/lib/statutes/slots";
import type { FormKey, StateCode } from "@/lib/statutes/types";
import { WaiverPreview } from "./WaiverPreview";

/**
 * The whole tool for one state: pick the form, fill it in, see it, download.
 *
 * Previewing needs nothing from anybody. Downloading the first time needs a
 * name and an email (the PDF goes to that address too); after the server
 * has accepted one, this browser is never asked again -- see
 * lib/waiver-request.ts for the rule and lib/browser-memory.ts for where
 * it is remembered.
 *
 * Nothing here says a waiver is safe to sign. The warnings describe what
 * the chosen form does, in the same words every time.
 */

type Stage = "PROGRESS" | "FINAL";

const chip =
  "min-h-touch rounded-lg border-2 px-4 py-2 text-left font-semibold transition-colors focus-visible:outline-focus";
const chipOn = "border-ink bg-brand text-ink";
const chipOff = "border-line bg-paper text-ink hover:border-ink";

export function WaiverTool({ state }: { state: StateCode }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [cleared, setCleared] = useState<boolean | null>(null);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<Contact | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Read this browser's memory after mount, never during render: the server
  // has no localStorage, so reading it in render would hydrate differently.
  useEffect(() => {
    setRaw(loadFields());
    setContact(loadContact());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveFields(raw);
  }, [raw, loaded]);

  const formKey: FormKey | null =
    stage && cleared !== null ? (`${cleared ? "UNCONDITIONAL" : "CONDITIONAL"}_${stage}` as FormKey) : null;
  const form = formKey ? getForm(state, formKey) : null;
  const checked = useMemo(() => (form ? checkFills(form, raw) : null), [form, raw]);

  const fieldProps = (id: string, slot: string, placeholder: string | undefined, help: string | undefined, invalid: boolean) => ({
    id,
    autoComplete: "off",
    placeholder,
    value: raw[slot] ?? "",
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setRaw((current) => ({ ...current, [slot]: event.target.value })),
    "aria-describedby": help ? `${id}-help` : undefined,
    "aria-invalid": invalid,
    className:
      "min-h-touch w-full rounded-md border-2 border-line bg-paper px-3 text-lg text-ink placeholder:text-quiet/70 focus:border-ink",
  });

  return (
    <div className="mt-8">
      <section aria-labelledby="pick">
        <h2 id="pick" className="text-xl font-bold text-ink">
          1. Which waiver?
        </h2>
        <fieldset className="mt-4">
          <legend className="font-semibold text-ink">Which payment is this for?</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button type="button" aria-pressed={stage === "PROGRESS"} className={`${chip} ${stage === "PROGRESS" ? chipOn : chipOff}`} onClick={() => setStage("PROGRESS")}>
              A progress payment
            </button>
            <button type="button" aria-pressed={stage === "FINAL"} className={`${chip} ${stage === "FINAL" ? chipOn : chipOff}`} onClick={() => setStage("FINAL")}>
              The final payment
            </button>
          </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="font-semibold text-ink">Has this payment cleared your bank?</legend>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button type="button" aria-pressed={cleared === false} className={`${chip} ${cleared === false ? chipOn : chipOff}`} onClick={() => setCleared(false)}>
              Not yet
            </button>
            <button type="button" aria-pressed={cleared === true} className={`${chip} ${cleared === true ? chipOn : chipOff}`} onClick={() => setCleared(true)}>
              Yes, it has cleared
            </button>
          </div>
        </fieldset>

        {formKey && form ? (
          <div className="mt-6 rounded-lg border-2 border-ink bg-paper p-4" aria-live="polite">
            <p className="text-sm font-semibold uppercase tracking-wide text-quiet">Your form</p>
            <p className="mt-1 text-lg font-bold text-ink">{FORM_NAMES[formKey]}</p>
            <p className="text-sm text-quiet">{form.citation}</p>
            <p className="mt-3 text-ink">{FORM_MEANINGS[formKey]}</p>
            {cleared ? <p className="mt-3 rounded-md bg-warn-ground p-3 font-semibold text-warn">{UNCONDITIONAL_WARNING}</p> : null}
            {stage === "FINAL" ? <p className="mt-3 rounded-md bg-warn-ground p-3 font-semibold text-warn">{FINAL_WARNING}</p> : null}
          </div>
        ) : null}
      </section>

      {form && checked ? (
        <>
          <section aria-labelledby="fill" className="mt-10">
            <h2 id="fill" className="text-xl font-bold text-ink">
              2. Fill in the blanks
            </h2>
            <p className="mt-1 text-sm text-quiet">Saved in this browser for next pay period. The signature line stays blank for your pen.</p>
            <div className="mt-4 space-y-5">
              {slotsAsked(form).map(({ slot, label }) => {
                const spec = SLOTS[slot];
                const id = `field-${slot}`;
                const error = checked.errors[slot];
                const showError = Boolean(error && raw[slot]?.trim());
                return (
                  <div key={slot}>
                    <label htmlFor={id} className="block font-semibold text-ink">
                      {label}
                      {spec.required ? null : <span className="font-normal text-quiet"> (optional)</span>}
                    </label>
                    {spec.help ? (
                      <p id={`${id}-help`} className="text-sm text-quiet">
                        {spec.help}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center">
                      {spec.kind === "money" ? <span className="mr-2 text-lg text-ink">$</span> : null}
                      {/* Three literal branches rather than one input with
                          computed type/inputMode, so C-Stream's repo-wide
                          numeric-input census (apps/web/lib/
                          numericInputCensus.test.ts) can READ that a money
                          field opens a keypad -- it cannot evaluate an
                          expression, and an unreadable attribute is checked,
                          not trusted. */}
                      {spec.kind === "money" ? (
                        <input type="text" inputMode="decimal" name={slot} {...fieldProps(id, slot, spec.placeholder, spec.help, showError)} />
                      ) : spec.kind === "date" ? (
                        <input type="date" name={slot} {...fieldProps(id, slot, spec.placeholder, spec.help, showError)} />
                      ) : (
                        <input type="text" name={slot} {...fieldProps(id, slot, spec.placeholder, spec.help, showError)} />
                      )}
                    </div>
                    {showError ? (
                      <p role="alert" className="mt-1 text-sm font-semibold text-danger">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="check" className="mt-10">
            <h2 id="check" className="text-xl font-bold text-ink">
              3. Read it
            </h2>
            <p className="mt-1 text-sm text-quiet">This is the whole form as it will print. Your entries are underlined.</p>
            <WaiverPreview form={form} fills={checked.fills} />
          </section>

          <Download state={state} formKey={formKey!} raw={raw} missing={Object.keys(checked.errors).length} contact={contact} onContact={setContact} />
        </>
      ) : null}

      {loaded && (contact || Object.keys(raw).length > 0) ? (
        <p className="mt-10 text-sm text-quiet">
          This browser remembers your details.{" "}
          <button
            type="button"
            className="inline-flex min-h-touch items-center underline"
            onClick={() => {
              forgetEverything();
              setRaw({});
              setContact(null);
            }}
          >
            Forget them
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Download({
  state,
  formKey,
  raw,
  missing,
  contact,
  onContact,
}: {
  state: StateCode;
  formKey: FormKey;
  raw: Record<string, string>;
  missing: number;
  contact: Contact | null;
  onContact: (contact: Contact) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [emailCopy, setEmailCopy] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (raw.companyName && !company) setCompany(raw.companyName);
    // Only a default; never overwrites what the person typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw.companyName]);

  const returning = contact !== null;

  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/waiver", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          form: formKey,
          fills: raw,
          returning,
          emailCopy: returning ? emailCopy : undefined,
          email: returning ? contact.email : email,
          name: returning ? contact.name : name,
          company: returning ? contact.company : company,
          marketingOptIn: returning ? undefined : marketing,
          website,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage({ tone: "error", text: body.error ?? "Something went wrong. Please try again." });
        return;
      }
      const blob = await response.blob();
      const filename = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "lien-waiver.pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const status = response.headers.get("x-email-status");
      const to = returning ? contact.email : email.trim();
      if (!returning) {
        const saved = { email: email.trim(), name: name.trim(), company: company.trim() };
        saveContact(saved);
        onContact(saved);
      }
      setMessage({
        tone: "ok",
        text:
          status === "sent"
            ? `Downloaded, and a copy is on its way to ${to}.`
            : status === "skipped-preview"
              ? `Downloaded. This is a preview site, so the email to ${to} was not sent.`
              : status === "failed"
                ? "Downloaded. We could not email a copy just now."
                : "Downloaded.",
      });
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Check your signal and try again." });
    } finally {
      setBusy(false);
    }
  }

  const blocked = missing > 0;
  return (
    <section aria-labelledby="download" className="mt-10 rounded-lg border-2 border-ink bg-paper p-4">
      <h2 id="download" className="text-xl font-bold text-ink">
        4. Download
      </h2>
      <form
        className="mt-3 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked && !busy) void download();
        }}
      >
        {returning ? (
          <label className="flex min-h-touch items-center gap-3 text-ink">
            <input type="checkbox" className="h-6 w-6" checked={emailCopy} onChange={(event) => setEmailCopy(event.target.checked)} />
            Also email a copy to {contact.email}
          </label>
        ) : (
          <>
            <p className="text-quiet">Where should we send your PDF? You only need to do this once in this browser.</p>
            <div>
              <label htmlFor="dl-name" className="block font-semibold text-ink">
                Your name
              </label>
              <input id="dl-name" type="text" name="name" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
            </div>
            <div>
              <label htmlFor="dl-email" className="block font-semibold text-ink">
                Email
              </label>
              <input id="dl-email" name="email" required type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
            </div>
            <div>
              <label htmlFor="dl-company" className="block font-semibold text-ink">
                Company <span className="font-normal text-quiet">(optional)</span>
              </label>
              <input id="dl-company" type="text" name="company" autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} className="mt-1 min-h-touch w-full rounded-md border-2 border-line px-3 text-lg focus:border-ink" />
            </div>
            <label className="flex min-h-touch items-start gap-3 text-ink">
              <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
              <span>Send me occasional emails from C-Stream about running a subcontracting business. (Optional. You will get your PDF either way.)</span>
            </label>
            {/* Honeypot: hidden from people and from screen readers. */}
            <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="dl-website">Website</label>
              <input id="dl-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
            </div>
          </>
        )}
        {blocked ? (
          <p className="font-semibold text-danger">
            {missing === 1 ? "One required blank is" : `${missing} required blanks are`} still empty or need another look above.
          </p>
        ) : null}
        <button type="submit" disabled={blocked || busy} className="min-h-primary w-full rounded-lg bg-brand px-5 text-lg font-bold text-ink hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Making your PDF..." : returning ? "Download PDF" : "Email me the PDF and download"}
        </button>
        <p className="text-sm text-quiet">
          Read the whole form before you sign it. C-Stream is not a law firm and this is not legal advice.{" "}
          {returning ? null : (
            <>
              See our{" "}
              <Link className="underline" href="/privacy">
                privacy notice
              </Link>
              .
            </>
          )}
        </p>
        {message ? (
          <p role="status" className={`rounded-md p-3 font-semibold ${message.tone === "ok" ? "bg-canvas text-ink" : "bg-warn-ground text-danger"}`}>
            {message.text}
          </p>
        ) : null}
      </form>
    </section>
  );
}

