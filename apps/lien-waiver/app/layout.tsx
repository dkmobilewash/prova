import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Free statutory lien waiver forms — AZ, CA, NV, TX",
    template: "%s — Free Lien Waiver Forms",
  },
  description:
    "Fill out your state's statutory lien waiver on your phone and download a clean PDF. Arizona, California, Nevada and Texas. Free, from C-Stream.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
