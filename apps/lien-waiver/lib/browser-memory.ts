/**
 * What this browser remembers, and nothing else does.
 *
 * The tool has no accounts and no lead database (Diego, 2026-10-08), so
 * "come back next pay period and your details are filled in" and "never
 * gate this browser again" both live here. Every access is wrapped: a
 * private window, blocked site data or a full quota must leave the page
 * working, just forgetful.
 */

const FIELDS = "lien-waiver:fields:v1";
const CONTACT = "lien-waiver:contact:v1";

export interface Contact {
  email: string;
  name: string;
  company: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the page still works, it just will not remember.
  }
}

export const loadFields = () => read<Record<string, string>>(FIELDS) ?? {};
export const saveFields = (fields: Record<string, string>) => write(FIELDS, fields);
/** Set only after the server accepted the address -- that is what makes this
 * browser "returning" and ungated from then on. */
export const loadContact = () => read<Contact>(CONTACT);
export const saveContact = (contact: Contact) => write(CONTACT, contact);
export function forgetEverything() {
  try {
    window.localStorage.removeItem(FIELDS);
    window.localStorage.removeItem(CONTACT);
  } catch {
    // Nothing to forget.
  }
}
