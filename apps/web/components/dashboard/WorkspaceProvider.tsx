'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  api,
  getToken,
  setToken,
  type ApiEnvironment,
  type ApiProject,
  type ApiUser,
} from '@/lib/api';

interface WorkspaceValue {
  user: ApiUser | null;
  projects: ApiProject[];
  project: ApiProject | null;
  environments: ApiEnvironment[];
  environment: ApiEnvironment | null;
  loading: boolean;
  error: string | null;
  selectProject: (id: string) => void;
  selectEnvironment: (id: string) => void;
  refreshProjects: (selectId?: string) => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  signOut: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

const PREFERRED_ENV = 'production';

/**
 * Loads the signed-in user's projects and environments and exposes the active
 * selection to every dashboard page. Redirects to /login when the session is
 * missing or rejected.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<ApiEnvironment[]>([]);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async (selectId?: string) => {
    const { projects: list } = await api.projects.list();
    setProjects(list);
    setProjectId((current) => {
      if (selectId && list.some((p) => p.id === selectId)) return selectId;
      if (current && list.some((p) => p.id === current)) return current;
      return list[0]?.id ?? null;
    });
  }, []);

  const refreshEnvironments = useCallback(async () => {
    if (!projectId) return;
    const { environments: list } = await api.environments.list(projectId);
    setEnvironments(list);
    setEnvironmentId((current) => {
      if (current && list.some((e) => e.id === current)) return current;
      return (
        list.find((e) => e.name === PREFERRED_ENV)?.id ?? list[0]?.id ?? null
      );
    });
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!getToken()) {
        router.replace('/login');
        return;
      }
      try {
        const { user: me } = await api.auth.me();
        if (cancelled) return;
        setUser(me);
        await refreshProjects();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          router.replace('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'failed to load workspace');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, refreshProjects]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) {
        setEnvironments([]);
        setEnvironmentId(null);
        return;
      }
      try {
        const { environments: list } = await api.environments.list(projectId);
        if (cancelled) return;
        setEnvironments(list);
        setEnvironmentId((current) => {
          if (current && list.some((e) => e.id === current)) return current;
          return (
            list.find((e) => e.name === PREFERRED_ENV)?.id ?? list[0]?.id ?? null
          );
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'failed to load environments',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const value = useMemo<WorkspaceValue>(
    () => ({
      user,
      projects,
      project: projects.find((p) => p.id === projectId) ?? null,
      environments,
      environment: environments.find((e) => e.id === environmentId) ?? null,
      loading,
      error,
      selectProject: setProjectId,
      selectEnvironment: setEnvironmentId,
      refreshProjects,
      refreshEnvironments,
      signOut: () => {
        setToken(null);
        void api.auth.logout().catch(() => undefined);
        router.replace('/');
      },
    }),
    [
      user,
      projects,
      projectId,
      environments,
      environmentId,
      loading,
      error,
      refreshProjects,
      refreshEnvironments,
      router,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}