import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Network",
  description: "Powered by XMTP × x402 × ERC8004 with full auditability",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
