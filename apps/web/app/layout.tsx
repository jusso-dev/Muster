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
    "Muster is the governed operating system for an AI-enabled security company.",
  applicationName: "Muster",
  icons: {
    icon: [
      { url: "/icons/muster-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/muster-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/muster-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/muster-96.png", sizes: "96x96", type: "image/png" },
    ],
    shortcut: [
      { url: "/icons/muster-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/icons/muster-180.png", sizes: "180x180", type: "image/png" },
    ],
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
