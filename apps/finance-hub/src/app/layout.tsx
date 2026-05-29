import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ApiKeyProvider } from "@/app/components/ApiKeyProvider";
import { AppShell } from "@/app/components/AppShell";
import { NavigationShortcuts } from "@/app/components/NavigationShortcuts";
import { PrivacyProvider } from "@/app/components/PrivacyProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Finance Hub",
  description: "Local-first personal finance hub",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full bg-zinc-50 font-sans text-[15px] leading-relaxed text-zinc-950 antialiased dark:bg-black dark:text-zinc-50"
        suppressHydrationWarning
      >
        <PrivacyProvider>
          <ApiKeyProvider>
            <NavigationShortcuts />
          <AppShell>{children}</AppShell>
          </ApiKeyProvider>
        </PrivacyProvider>
      </body>
    </html>
  );
}
