import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { MotionProvider } from "@/components/chrome/motion-provider";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "XApps — challenge anyone on X",
    template: "%s · XApps",
  },
  description:
    "Sign in with X and go head-to-head: reflex duels, meme battles, hot-take showdowns and more. Build your own app with the XApps SDK.",
  applicationName: "XApps",
  openGraph: {
    type: "website",
    siteName: "XApps",
    title: "XApps — challenge anyone on X",
    description: "Mini games, meme duels and hot-take showdowns against anyone on X.",
  },
  twitter: {
    card: "summary_large_image",
    title: "XApps — challenge anyone on X",
    description: "Mini games, meme duels and hot-take showdowns against anyone on X.",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}>
      <body className="min-h-dvh">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
