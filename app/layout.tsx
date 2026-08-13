import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://wikicompare.app"),
  title: "Wiki Compare",
  description: "Explore differences between narratives through Wikipedia articles",
  openGraph: {
    title: "Wiki Compare",
    description: "Explore differences between narratives through Wikipedia articles",
    url: "https://wikicompare.app",
    siteName: "Wiki Compare",
    locale: "en",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Wiki Compare",
    description: "Explore differences between narratives through Wikipedia articles",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Matching serif and sans families across all three scripts, so the
            columns read as siblings rather than three unrelated documents. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Noto+Serif:wght@400;600&family=Noto+Serif+Hebrew:wght@400;600&family=Noto+Naskh+Arabic:wght@400;600&family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Hebrew:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
