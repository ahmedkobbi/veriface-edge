import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "VeriFace Edge — Privacy-First Web Facial Authentication",
    template: "%s · VeriFace Edge",
  },
  description:
    "Military-grade, privacy-first facial authentication SDK. All biometric computation runs in your browser via WebGPU + WASM. The backend receives only zero-knowledge proofs — it cannot reconstruct your face.",
  keywords: [
    "facial authentication",
    "biometric security",
    "face recognition",
    "liveness detection",
    "rPPG",
    "WebGPU",
    "WASM",
    "zero-knowledge proofs",
    "FIDO2",
    "WebAuthn",
    "GDPR",
    "BIPA",
    "edge AI",
    "privacy-first",
  ],
  authors: [{ name: "VeriFace Edge" }],
  creator: "VeriFace Edge",
  publisher: "VeriFace Edge",
  applicationName: "VeriFace Edge",
  category: "security",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: ["/brand/favicon.ico"],
  },
  appleWebApp: {
    capable: true,
    title: "VeriFace Edge",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "VeriFace Edge",
    title: "VeriFace Edge — Privacy-First Web Facial Authentication",
    description:
      "Military-grade, privacy-first facial authentication SDK. All biometric computation runs in your browser via WebGPU + WASM. The backend cannot reconstruct your face.",
    images: [
      {
        url: "/brand/og-image.png",
        width: 1200,
        height: 630,
        alt: "VeriFace Edge — Privacy-First Web Facial Authentication",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VeriFace Edge — Privacy-First Web Facial Authentication",
    description:
      "Military-grade, privacy-first facial authentication SDK. Edge-AI, ZK proofs, ISO 30107-3 ready, GDPR compliant.",
    images: ["/brand/og-image.png"],
    creator: "@veriface",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#10b981" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link rel="preconnect" href="https://storage.googleapis.com" />
        <link rel="preconnect" href="https://huggingface.co" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
