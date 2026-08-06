import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "wiki-compare",
  description: "Read the English, Hebrew and Arabic Wikipedia on one subject side by side, with the disagreements marked.",
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
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Noto+Serif:wght@400;600&family=Noto+Serif+Hebrew:wght@400;600&family=Noto+Naskh+Arabic:wght@400;600&family=Noto+Sans:wght@400;600;700&family=Noto+Sans+Hebrew:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
