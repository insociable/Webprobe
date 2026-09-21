import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agency Monitor — surveillance de sites clients",
  description:
    "Détectez les régressions, documentez la maintenance et partagez des rapports de marque.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
