import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlagForge — Ship behind flags. Evaluate in under 5ms.',
  description:
    'A deterministic feature flag engine: two-tier L1/Redis caching, Pub/Sub invalidation, sticky MurmurHash3 bucketing, real-time SSE streaming and Zod-validated AI targeting rules.',
  openGraph: {
    title: 'FlagForge',
    description:
      'Feature flags with two-tier caching, instant Pub/Sub invalidation and sub-5ms evaluation.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
