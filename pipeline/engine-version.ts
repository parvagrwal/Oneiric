import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

/** Git commit of the engine if the repo has one; otherwise a hash of the engine sources, labelled as such. */
export function engineVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain engine', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (sha) return dirty ? `${sha}+uncommitted-engine-changes` : sha;
  } catch { /* no git repository yet */ }
  const h = createHash('sha256');
  for (const f of readdirSync('engine').filter((n) => n.endsWith('.ts')).sort()) h.update(f).update(readFileSync(`engine/${f}`));
  return `no-git-repository; engine-sources-sha256:${h.digest('hex').slice(0, 16)}`;
}
