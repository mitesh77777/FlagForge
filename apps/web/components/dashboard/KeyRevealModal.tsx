'use client';

import { AlertTriangle } from 'lucide-react';
import type { ApiEnvironmentWithKey } from '@/lib/api';
import { Badge, Button, CopyButton } from '@/components/ui';
import { Modal } from './Modal';

export function KeyRevealModal({
  open,
  onClose,
  environments,
  title = 'Your SDK keys',
  description = 'Copy these now. Only a SHA-256 hash is stored, so a raw key can never be shown again.',
}: {
  open: boolean;
  onClose: () => void;
  environments: ApiEnvironmentWithKey[];
  title?: string;
  description?: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <Button variant="primary" onClick={onClose}>
          I have saved my keys
        </Button>
      }
    >
      <div className="space-y-3">
        {environments.map((environment) => (
          <div
            key={environment.id}
            className="rounded border border-line bg-black p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-muted">
                {environment.name}
              </span>
              <Badge tone={environment.tier === 'live' ? 'emerald' : 'amber'}>
                {environment.tier}
              </Badge>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-2xs text-ink">
                {environment.sdkKey}
              </code>
              <CopyButton text={environment.sdkKey} />
            </div>
          </div>
        ))}

        <p className="flex items-start gap-1.5 rounded border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-2xs leading-relaxed text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          This is the only time these keys are displayed. Keys are hashed at rest;
          if you lose one, rotate it from SDK &amp; Keys.
        </p>
      </div>
    </Modal>
  );
}