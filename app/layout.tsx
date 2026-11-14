import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aadya Farms Milk Ledger",
  description: "Shared online milk delivery ledger, payments and customer invoices.",
  icons: {
    icon: "/favicon.svg?v=5",
    shortcut: "/favicon.svg?v=5",
    apple: "/ledger/assets/aadya-logo.png?v=5",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
