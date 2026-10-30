import fs from 'fs';
import path from 'path';
import { ConfigFile } from '../types/yxorp-config';
import { LoadedConfig, loadConfigFile, patternToRegExp } from './config-loader';

const DEBOUNCE_MS = 100;

export interface ConfigWatcher {
  close(): void;
}

/**
 * Watches a config file and every file it includes; on a change, reloads and
 * merges them all and calls `onReload` with the result (or `onError`).
 *
 * Watches the files' *directories* (filtering events by file name) rather
 * than the files themselves — editors that save via atomic rename (vim, etc.)
 * replace the inode, after which fs.watch on the old path stops firing. That
 * also lets a newly created file matching an include wildcard trigger a reload.
 * The watched set is updated after every reload, as `include` may have changed.
 */
export function watchConfig(
  configPath: string,
  onReload: (config: ConfigFile, loaded: LoadedConfig) => void,
  onError: (err: unknown) => void,
): ConfigWatcher {
  const watchers = new Map<string, fs.FSWatcher>();
  let isRelevant: (dir: string, file: string) => boolean = () => true;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const onEvent = (dir: string, changedFile: string | null) => {
    if (changedFile && !isRelevant(dir, changedFile)) return;
    if (debounceTimer) return;

    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      try {
        // An editor may truncate the file before writing it — wait for the content.
        if (!fs.readFileSync(configPath, 'utf-8').trim()) return;

        const loaded = loadConfigFile(configPath);
        watch(loaded);
        onReload(loaded.config, loaded);
      } catch (e) {
        onError(e);
      }
    }, DEBOUNCE_MS);
  };

  const watch = (loaded: Pick<LoadedConfig, 'files' | 'includePatterns'>) => {
    if (closed) return;

    const files = new Set(loaded.files.map(file => path.resolve(file)));
    const patterns = loaded.includePatterns.map(pattern => ({
      dir: path.dirname(pattern),
      regex: patternToRegExp(path.basename(pattern)),
    }));

    isRelevant = (dir, file) =>
      files.has(path.join(dir, file)) ||
      patterns.some(pattern => pattern.dir === dir && pattern.regex.test(file));

    const dirs = new Set([...files].map(file => path.dirname(file)));
    patterns.forEach(pattern => dirs.add(pattern.dir));

    for (const [dir, watcher] of watchers) {
      if (!dirs.has(dir)) {
        watcher.close();
        watchers.delete(dir);
      }
    }

    for (const dir of dirs) {
      if (watchers.has(dir)) continue;

      try {
        watchers.set(dir, fs.watch(dir, (_eventType, changedFile) => onEvent(dir, changedFile?.toString() ?? null)));
      } catch {
        // A directory that doesn't exist (yet) — nothing to watch there.
      }
    }
  };

  try {
    watch(loadConfigFile(configPath));
  } catch {
    // Watch at least the main config, so fixing it triggers a reload.
    watch({ files: [configPath], includePatterns: [] });
  }

  return {
    close: () => {
      closed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      watchers.forEach(watcher => watcher.close());
      watchers.clear();
    },
  };
}
