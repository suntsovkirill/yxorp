import fs from 'fs';
import { ConfigFile } from '../types/yxorp-config';

export function watchConfig(
  configPath: string,
  onReload: (config: ConfigFile) => void,
  onError: (err: unknown) => void,
): fs.FSWatcher {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return fs.watch(configPath, () => {
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
