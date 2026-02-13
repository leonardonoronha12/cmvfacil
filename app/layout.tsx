import type { ReactNode } from "react";
import AuthRecoveryRedirect from "./AuthRecoveryRedirect";
import "./globals.css";

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
      </head>
      <body>
        <AuthRecoveryRedirect />
        {children}
      </body>
    </html>
  );
}
