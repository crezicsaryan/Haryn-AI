import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-jb",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Haryn AI — Your AI Codebase Doctor",
  description:
    "Paste a public GitHub repository and get an evidence-based engineering health report in minutes. No signup required.",
  applicationName: "Haryn AI",
  keywords: [
    "codebase analysis",
    "code review",
    "static analysis",
    "security scan",
    "GitHub",
    "technical debt",
  ],
  openGraph: {
    title: "Haryn AI — Your AI Codebase Doctor",
    description:
      "Understand. Diagnose. Improve Code. Paste a public GitHub repository and get a health report in minutes.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfcfd",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jakarta.variable} ${instrument.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
