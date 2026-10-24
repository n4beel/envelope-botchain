import type { Metadata, Viewport } from "next";
import { Fraunces, Nunito_Sans, Red_Hat_Mono } from "next/font/google";
import { EvmProvider } from "@/components/providers/EvmProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { app } from "@/lib/app-config";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700", "900"],
});

const nunitoSans = Nunito_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const redHatMono = Red_Hat_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: `${app.name} — ${app.tagline}`,
  description: app.tagline,
  openGraph: { title: app.name, description: app.tagline, type: "website", url: app.url },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#C9A872",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${nunitoSans.variable} ${redHatMono.variable} h-full`}
      style={{ ["--accent" as string]: app.accent }}
    >
      <body className="min-h-full antialiased font-sans selection:bg-[#7A1523]/20 selection:text-[#7A1523]">
        <EvmProvider>
          <ToastProvider>{children}</ToastProvider>
        </EvmProvider>
      </body>
    </html>
  );
}
