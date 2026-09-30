import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { HostLinkGuard } from "@/components/chrome/host-link-guard";
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

/**
 * iOS WebKit (Safari and every iOS browser, Chrome included) could leave a
 * navigation frozen on the old page mid view transition: the URL changed but
 * nothing rendered until a refresh. Without `startViewTransition` React applies
 * the update directly (its fallback path), so iOS gets plain, instant
 * navigations; other browsers keep the page transitions.
 */
const NO_IOS_VIEW_TRANSITIONS = `(function(){try{var n=navigator,ios=/iP(hone|ad|od)/.test(n.userAgent)||(n.platform==="MacIntel"&&n.maxTouchPoints>1);if(ios&&"startViewTransition" in Document.prototype)Object.defineProperty(Document.prototype,"startViewTransition",{value:undefined,configurable:true,writable:true});}catch(e){}})();`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "XApps — challenge anyone on X",
    template: "%s · XApps",
  },
  description:
    "Sign in with X and go head-to-head: reflex duels, meme battles, robot brawls and more. Build your own app with the XApps SDK.",
  applicationName: "XApps",
  openGraph: {
    type: "website",
    siteName: "XApps",
    title: "XApps — challenge anyone on X",
    description: "Mini games and meme duels against anyone on X.",
  },
  twitter: {
    card: "summary_large_image",
    title: "XApps — challenge anyone on X",
    description: "Mini games and meme duels against anyone on X.",
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
        <Script id="no-ios-view-transitions" strategy="beforeInteractive">
          {NO_IOS_VIEW_TRANSITIONS}
        </Script>
        <HostLinkGuard />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
