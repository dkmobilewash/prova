import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prova",
  description: "Contractor operating system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#3b82f6",
          colorBackground: "#0f172a",
          colorInputBackground: "#1e293b",
          colorInputText: "#f1f5f9",
          colorText: "#f1f5f9",
          colorTextSecondary: "#94a3b8",
          colorNeutral: "#94a3b8",
          borderRadius: "0.5rem",
        },
      }}
    >
      <html lang="en">
        <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
      </html>
    </ClerkProvider>
  );
}
