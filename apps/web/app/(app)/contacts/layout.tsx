// The contacts page is a client component, which cannot export metadata, so
// its tab title lives here. /contacts/[id] sets its own.
export const metadata = { title: "Contacts" };

export default function ContactsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
