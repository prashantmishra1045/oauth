import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Greenlight — OAuth app setup & approval guides", template: "%s · Greenlight" },
  description:
    "How hard is it to get your OAuth app approved? Effort, waiting time, requirements and blockers for 100 apps, plus an agent that researches any other app live.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-brand text-xs text-white" aria-hidden>
                ✓
              </span>
              Greenlight
            </Link>
            <nav className="flex items-center gap-5 text-sm text-zinc-600">
              <Link href="/#library" className="hover:text-zinc-900">
                Library
              </Link>
              <Link href="/method" className="hover:text-zinc-900">
                How guides are made
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="no-print border-t border-line py-6 text-center text-xs text-zinc-500">
          Guides are researched by agents and checked against sources. Policies change: check the evidence badges and the date on each guide.
        </footer>
      </body>
    </html>
  );
}
