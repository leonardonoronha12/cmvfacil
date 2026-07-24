import type { ReactNode } from "react";
import type { Metadata } from "next";
import AuthRecoveryRedirect from "./AuthRecoveryRedirect";
import AppShell from "./components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "CMV Fácil",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    apple: [{ url: "/favicon.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@400;500;600;700&family=Poppins:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap"
        />
        <link rel="icon" href="/favicon.png" type="image/png" />
      </head>
      <body>
        <AuthRecoveryRedirect />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
