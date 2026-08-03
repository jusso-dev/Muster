import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Muster Ops",
    template: "%s · Muster",
  },
  description:
    "Read-only ops briefing for Tawny, Kelpie, and Brolga. Chat is in Slack.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
