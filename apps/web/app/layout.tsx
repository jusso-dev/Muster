import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Muster",
    template: "%s · Muster",
  },
  description:
    "Muster is the shared workspace for human and agent-driven security operations.",
  applicationName: "Muster",
  icons: {
    icon: "/muster-logo.png",
    apple: "/muster-logo.png",
  },
  appleWebApp: {
    capable: true,
    title: "Muster",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#15191f" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          <PwaRegister />
        </Providers>
      </body>
    </html>
  );
}
