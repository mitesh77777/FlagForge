'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown,
  FlaskConical,
  Flag,
  History,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
} from 'lucide-react';
import { api, type ApiEnvironmentWithKey } from '@/lib/api';
import { Badge, Button, StatusDot } from '@/components/ui';
import { KeyRevealModal } from './KeyRevealModal';
import { Modal } from './Modal';
import { useWorkspace } from './WorkspaceProvider';

const NAV = [
  { href: '/dashboard/flags', label: 'Feature Flags', icon: Flag },
  { href: '/dashboard/audit', label: 'Audit Log', icon: History },
  { href: '/dashboard/keys', label: 'SDK & Keys', icon: KeyRound },
  { href: '/dashboard/playground', label: 'Live Playground', icon: FlaskConical },
] as const;

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="3.2" rx="1.6" fill="#FAFAFA" />
        <rect x="2.5" y="10.4" width="12" height="3.2" rx="1.6" fill="#10B981" />
        <rect x="2.5" y="17.3" width="6.5" height="3.2" rx="1.6" fill="#FAFAFA" fillOpacity="0.35" />
      </svg>
      <span className="text-sm font-semibold tracking-tight text-ink">FlagForge</span>
    </span>
  );
}

function ProjectSwitcher({ onNewProject }: { onNewProject: () => void }) {
  const { projects, project, selectProject } = useWorkspace();

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="project-switcher"
        className="block text-2xs uppercase tracking-[0.14em] text-ink-faint"
      >
        Project
      </label>
      <div className="relative">
        <select
          id="project-switcher"
          value={project?.id ?? ''}
          onChange={(event) => selectProject(event.target.value)}
          className="w-full appearance-none rounded border border-line bg-card px-2.5 py-1.5 pr-7 text-xs text-ink focus:border-emerald-500/50 focus:outline-none"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
      </div>
      <button
        type="button"
        onClick={onNewProject}
        className="flex w-full items-center gap-1.5 rounded border border-dashed border-line px-2.5 py-1.5 text-2xs text-ink-muted transition hover:border-line-strong hover:text-ink"
      >
        <Plus className="h-3 w-3" />
        New Project
      </button>
    </div>
  );
}

function EnvironmentSwitcher() {
  const { environments, environment, selectEnvironment } = useWorkspace();

  return (
    <div className="space-y-1.5">
      <span className="block text-2xs uppercase tracking-[0.14em] text-ink-faint">
        Environment
      </span>
      <div className="flex rounded border border-line bg-card p-0.5">
        {environments.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectEnvironment(item.id)}
            className={`flex-1 truncate rounded px-2 py-1 text-2xs capitalize transition ${
              environment?.id === item.id
                ? 'bg-line text-ink'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {item.name}
          </button>
        ))}
        {environments.length === 0 && (
          <span className="px-2 py-1 text-2xs text-ink-faint">none</span>
        )}
      </div>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-0.5">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs transition ${
              active
                ? 'bg-card text-ink'
                : 'text-ink-muted hover:bg-card/60 hover:text-ink'
            }`}
          >
            <item.icon className={`h-3.5 w-3.5 ${active ? 'text-emerald-500' : ''}`} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, loading, error, refreshProjects, signOut, environment } =
    useWorkspace();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<ApiEnvironmentWithKey[] | null>(null);

  const createProject = async () => {
    if (newName.trim().length === 0 || busy) return;
    setBusy(true);
    setCreateError(null);
    try {
      const created = await api.projects.create({ name: newName.trim() });
      setCreating(false);
      setNewName('');
      setRevealed(created.environments);
      await refreshProjects(created.project.id);
      router.push('/dashboard/flags');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'failed to create project');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center gap-2 bg-canvas text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-mono text-2xs">loading workspace…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
        <div className="border-b border-line px-4 py-3.5">
          <Link href="/">
            <Logo />
          </Link>
        </div>

        <div className="space-y-4 border-b border-line px-3 py-4">
          <ProjectSwitcher onNewProject={() => setCreating(true)} />
          <EnvironmentSwitcher />
        </div>

        <div className="flex-1 px-3 py-4">
          <span className="mb-2 block px-2.5 text-2xs uppercase tracking-[0.14em] text-ink-faint">
            Workspace
          </span>
          <NavLinks />
        </div>

        <div className="border-t border-line px-3 py-3">
          <div className="flex items-center gap-2 px-1">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-card font-mono text-2xs uppercase text-ink-muted">
              {user?.name?.slice(0, 1) ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-2xs text-ink">{user?.name}</span>
              <span className="block truncate font-mono text-2xs text-ink-faint">
                {user?.email}
              </span>
            </span>
            <button
              type="button"
              onClick={signOut}
              aria-label="sign out"
              className="shrink-0 text-ink-faint transition hover:text-ink"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="border-b border-line bg-panel px-3 py-2.5 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/">
              <Logo />
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="text-2xs text-ink-muted transition hover:text-ink"
            >
              Sign out
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <ProjectSwitcher onNewProject={() => setCreating(true)} />
            <EnvironmentSwitcher />
          </div>
          <div className="mt-2.5 flex gap-1 overflow-x-auto pb-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex shrink-0 items-center gap-1.5 rounded border border-line bg-card px-2 py-1 text-2xs text-ink-muted"
              >
                <item.icon className="h-3 w-3" />
                {item.label}
              </Link>
            ))}
          </div>
        </header>

        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <StatusDot tone={environment ? 'emerald' : 'neutral'} pulse={Boolean(environment)} />
          <span className="font-mono text-2xs text-ink-muted">
            {environment ? `${environment.name} environment` : 'no environment'}
          </span>
          {environment && (
            <Badge className="ml-auto">{environment.sdkKeyPrefix}…</Badge>
          )}
        </div>

        {error && (
          <div className="border-b border-red-500/25 bg-red-500/[0.06] px-4 py-2 text-2xs text-red-400">
            {error}
          </div>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>

      {/* New project */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create a project"
        description="A new project starts with Development and Production environments."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => void createProject()}
              disabled={busy || newName.trim().length === 0}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create project
            </Button>
          </>
        }
      >
        <label htmlFor="project-name" className="mb-1.5 block text-2xs text-ink-muted">
          Project name
        </label>
        <input
          id="project-name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void createProject();
          }}
          placeholder="Acme Mobile"
          autoFocus
          className="w-full rounded border border-line bg-black px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-emerald-500/50 focus:outline-none"
        />
        {createError && (
          <p className="mt-2 text-2xs text-red-400">{createError}</p>
        )}
      </Modal>

      {revealed && (
        <KeyRevealModal
          open
          onClose={() => setRevealed(null)}
          environments={revealed}
          title="Project created — save your SDK keys"
        />
      )}
    </div>
  );
}