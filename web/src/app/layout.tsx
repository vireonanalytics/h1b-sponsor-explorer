import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { pool } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "H-1B Sponsor Explorer",
  description: "Search U.S. DOL H-1B LCA disclosure data",
};

async function getDataAsOf() {
  try {
    const { rows } = await pool.query(
      `SELECT to_char(max(decision_date), 'Mon DD, YYYY') AS data_as_of FROM lca_filings`
    );
    return rows[0]?.data_as_of as string | undefined;
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const dataAsOf = await getDataAsOf();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-black/10 dark:border-white/10">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6 text-sm">
            <a href="/" className="font-semibold">
              H-1B Sponsor Explorer
            </a>
            <a href="/" className="text-black/60 dark:text-white/60 hover:text-current">
              Search
            </a>
            <a href="/roles" className="text-black/60 dark:text-white/60 hover:text-current">
              Role Explorer
            </a>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-black/10 dark:border-white/10 py-4">
          <p className="max-w-6xl mx-auto px-4 text-xs text-black/50 dark:text-white/50">
            Source: U.S. Department of Labor, Office of Foreign Labor Certification (OFLC)
            H-1B LCA disclosure data, FY2024 Q1–Q4, FY2025 Q1–Q4, FY2026 Q3. Public data, no
            external API used.{" "}
            {dataAsOf && <>Data current through <strong>{dataAsOf}</strong> (the most recent quarter DOL has published).</>}
          </p>
        </footer>
      </body>
    </html>
  );
}
