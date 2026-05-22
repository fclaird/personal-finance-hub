import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LiveStatusBanner } from "@/app/components/LiveStatusBanner";
import { NavigationShortcuts } from "@/app/components/NavigationShortcuts";
import { PrivacyProvider } from "@/app/components/PrivacyProvider";
import { SidebarNav } from "@/app/components/SidebarNav";

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
          <NavigationShortcuts />
          <div className="flex h-dvh overflow-hidden">
            <SidebarNav />
            <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
              <LiveStatusBanner />
              {children}
            </main>
          </div>
        </PrivacyProvider>
      </body>
    </html>
  );
}
