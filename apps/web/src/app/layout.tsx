import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const siteTitle =
  "WebProbe — audit, monitoring et analyse technique de sites web";
const siteDescription =
  "Analysez la sécurité, les performances, le SEO et la configuration technique de vos sites web avec des rapports clairs et des recommandations actionnables.";

export const metadata: Metadata = {
  metadataBase: new URL("https://webprobe.fr"),
  title: siteTitle,
  description: siteDescription,
  applicationName: "WebProbe",
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "https://webprobe.fr/",
    siteName: "WebProbe",
    type: "website",
    locale: "fr_FR",
    images: [
      {
        url: "/og/webprobe-share.png",
        width: 1200,
        height: 630,
        alt: "WebProbe — audit, monitoring, sécurité, performances et SEO",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og/webprobe-share.png"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
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
