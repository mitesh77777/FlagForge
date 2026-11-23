'use client';

import type { ReactNode } from 'react';
import { CopyButton } from './ui';

/**
 * A deliberately tiny syntax highlighter.
 *
 * Pulling in a highlighter (Shiki/Prism) for one shipped code sample would cost
 * more bytes than the SDK itself, so a single anchored regex covers comments,
 * strings, keywords, numbers, types and calls — which is all this snippet uses.
 */
const TOKEN =
  /(\/\/[^\n]*)|('[^']*'|"[^"]*"|`[^`]*`)|(\b(?:import|from|const|let|await|new|return|async|export|if|else|interface|type|boolean|string|number|true|false|null)\b)|(\b\d+(?:\.\d+)?\b)|([A-Z][A-Za-z0-9_]*)|([a-zA-Z_$][\w$]*)(?=\()/g;

function highlight(code: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(code)) !== null) {
    if (match.index > cursor) nodes.push(code.slice(cursor, match.index));

    const className = match[1]
      ? 'tok-com'
      : match[2]
        ? 'tok-str'
        : match[3]
          ? 'tok-key'
          : match[4]
            ? 'tok-num'
            : match[5]
              ? 'tok-type'
              : 'tok-fn';

    nodes.push(
      <span key={key++} className={className}>
        {match[0]}
      </span>,
    );
    cursor = TOKEN.lastIndex;
  }

  if (cursor < code.length) nodes.push(code.slice(cursor));
  return nodes;
}

export function CodeSample({
  code,
  filename,
  className = '',
}: {
  code: string;
  filename?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-line bg-panel ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-mono text-2xs text-ink-muted">
          {filename ?? 'example.ts'}
        </span>
        <CopyButton text={code} label="Copy" className="ml-auto border-0 bg-transparent px-1" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink-muted">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}
