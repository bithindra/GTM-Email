import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import AutoDispatch from "@/components/AutoDispatch";

export const metadata: Metadata = {
  title: "GTM Flow — Founder Outreach Engine",
  description: "Source B2B founders globally, craft outreach, send and track performance — one GTM flow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AutoDispatch />
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
