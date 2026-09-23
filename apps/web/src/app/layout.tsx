import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agency Monitor — surveillance de sites clients",
  description:
    "Détectez les régressions, documentez la maintenance et partagez des rapports de marque.",
};

const themeBootstrap = [
  "(function(){",
  'var key="agency-monitor-theme";',
  "var stored=null;",
  "try{stored=localStorage.getItem(key);}catch(e){}",
  'var theme=stored==="light"||stored==="dark"?stored:',
  'window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";',
  "document.documentElement.dataset.theme=theme;",
  "document.documentElement.style.colorScheme=theme;",
  "})();",
].join("");

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
