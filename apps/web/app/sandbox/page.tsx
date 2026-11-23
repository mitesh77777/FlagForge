import { redirect } from 'next/navigation';

/**
 * The original single-project sandbox has been replaced by the authenticated
 * dashboard (Feature Flags / Audit Log / SDK & Keys / Live Playground).
 */
export default function SandboxPage() {
  redirect('/dashboard');
}