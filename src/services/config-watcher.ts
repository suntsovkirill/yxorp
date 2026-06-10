import fs from 'fs';
import path from 'path';
import { ConfigFile } from '../types/yxorp-config';

export function watchConfig(
  configPath: string,
  onReload: (config: ConfigFile) => void,
  onError: (err: unknown) => void,
): fs.FSWatcher {
  const dir = path.dirname(configPath);
  const filename = path.basename(configPath);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Watch the parent directory rather than the file itself — editors that
  // save via atomic rename (vim, etc.) replace the inode, after which
  // fs.watch on the old file path stops firing.
  return fs.watch(dir, (_eventType, changedFile) => {
    if (changedFile && changedFile !== filename) return;

    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        if (!raw.trim()) return;
        onReload(JSON.parse(raw) as ConfigFile);
      } catch (e) {
        onError(e);
      }
    }, 100);
  });
}
