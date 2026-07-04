import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Korrali Growth — Done-For-You B2B Cold Email & Outbound",
  description:
    "Done-for-you B2B outbound: AI-verified email discovery, personalized cold-email sequences, and AI reply classification. Wake up to interested prospects — no SDR hire required.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
