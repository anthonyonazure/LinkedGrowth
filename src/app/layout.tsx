import type { Metadata, Viewport } from "next";
import { Sora, DM_Sans, Host_Grotesk, Instrument_Sans, Caveat } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ScrollLockFix } from "@/components/providers/scroll-lock-fix";
import { ScrollToTop } from "@/components/providers/scroll-to-top";
import {
  OrganizationJsonLd,
  WebsiteJsonLd,
  SoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { isCloud } from "@/lib/edition";
import { requestAppUrl } from "@/lib/app-url-server";
import "./globals.css";

// Sora - premium geometric sans-serif, bold and futuristic for headings
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600", "700", "800"],
});

// DM Sans - clean, modern body font
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

// Host Grotesk - v2 display face. Scoped to the v2 dashboard for now via
// font-grotesk; --font-display stays on Sora until the marketing rebuild.
const hostGrotesk = Host_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  weight: ["400", "500", "600", "700"],
});

// Instrument Sans and Caveat belong to the v3 marketing design. Scoped to those
// components by their own variables, so nothing already shipped changes face.
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  weight: ["400", "500", "600", "700"],
});

const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-hand",
  weight: ["400", "600"],
});

const TITLE = "Lead Generation on LinkedIn, Run by an AI Agent | LinkedGrow";
const DESCRIPTION =
  "Lead generation on LinkedIn, run by an agent that finds your leads, sends the invitation and opens the conversation, inside limits that keep your account safe.";

// The default OG image lives on the cloud's R2 bucket. A self hosted instance
// has no public image to offer, so it advertises none.
const CLOUD_OG_IMAGE = "https://pub-86332bae77404495924b3ef7d4cbe7db.r2.dev/og/home.webp";

// The address is the one this request arrived on, so a self hosted instance
// answers with its own canonical whatever address somebody put in front of it.
// The cloud reads its pinned value and no header, so nothing it prerenders
// today starts rendering per request.
export async function generateMetadata(): Promise<Metadata> {
  const APP_URL = await requestAppUrl();
  return {
    metadataBase: new URL(APP_URL),
    title: TITLE,
    description: DESCRIPTION,
    authors: [{ name: "LinkedGrow" }],
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: APP_URL,
      siteName: "LinkedGrow",
      type: "website",
      ...(isCloud()
        ? {
            images: [
              {
                url: CLOUD_OG_IMAGE,
                width: 1200,
                height: 630,
                alt: "LinkedGrow, the LinkedIn AI agent that finds leads and opens conversations",
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      ...(isCloud() ? { images: [CLOUD_OG_IMAGE] } : {}),
    },
    alternates: {
      canonical: APP_URL,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (theme === 'system' || !theme) && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* Analytics, off unless this instance is told to keep them, and
            first-party either way.
     
            What was here loaded a tracker from a third party's domain and
            posted every page view to them, including the absolute URL and the
            query string. This app's URLs carry agent and lead identifiers, so
            that was a leak wearing an analytics badge. The replacement is
            served from this instance, posts to this instance, stores the path
            only, and is read back at /insight.
     
            Opt-in rather than on: a self hosted instance that starts recording
            its user without being asked has made that decision for every other
            person who installs it. */}
        {process.env.INSIGHT_ENABLED === "true" && (
          <script defer data-site="linkedgrow" src="/insight/t.js" />
        )}
        {isCloud() && (
          <>
            <OrganizationJsonLd />
            <WebsiteJsonLd />
            <SoftwareApplicationJsonLd />
          </>
        )}
      </head>
      <body className={`${sora.variable} ${dmSans.variable} ${hostGrotesk.variable} ${instrumentSans.variable} ${caveat.variable} font-sans antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider>
            <SessionProvider>
              <ScrollLockFix />
              <ScrollToTop />
              {children}
            </SessionProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
