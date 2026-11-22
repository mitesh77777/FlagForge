import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlagForge — Feature Flags & Gradual Rollout Engine',
  description:
    'Control plane / data plane feature flag engine with two-tier caching, deterministic MurmurHash3 bucketing, SSE streaming and an AI rule compiler.',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950 text-zinc-200">{children}</body>
    </html>
  );
}