/**
 * Runs the local preview: the in-memory demo API plus the Next.js web app.
 *
 *   pnpm preview
 *
 * Stop both with Ctrl+C. The production stack is `docker compose up --build`.
 */
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

function run(label, command) {
  const child = spawn(command, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`\n[preview] ${label} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[preview] starting FlagForge (demo API + web)\n');
run('api', 'node tools/demo-server.mjs');
run('web', 'pnpm --filter @flagforge/web start');
