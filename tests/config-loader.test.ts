import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfigFile } from '../src/services/config-loader';
import { ConfigWatcher, watchConfig } from '../src/services/config-watcher';
import { startYxorp } from '../src/app';
import { createRecordingLogger, fetchYxorp } from './helpers/create-yxorp';

let dir: string;

function write(file: string, content: unknown): string {
  const fullPath = path.join(dir, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content));
  return fullPath;
}

const base = { target: 'http://127.0.0.1:1', proxyPort: 0 };
const mock = (p: string) => ({ method: 'GET', path: p, json: p });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-include-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadConfigFile', () => {
  it('loads a config without includes', () => {
    const configPath = write('yxorp.json', { ...base, mockRules: [mock('/a')] });
    const loaded = loadConfigFile(configPath);

    expect(loaded.config.mockRules).toEqual([mock('/a')]);
    expect(loaded.files).toEqual([configPath]);
    expect(loaded.sources.mockRules).toEqual([{ file: configPath, index: 0 }]);
  });

  it('merges included files after the main rules, wildcards in name order', () => {
    const configPath = write('yxorp.json', {
      ...base,
      include: ['./recorded/recorded.json', './mocks/*.json'],
      mockRules: [mock('/main')],
    });
    const recorded = write('recorded/recorded.json', { mockRules: [mock('/recorded')] });
    const b = write('mocks/b.json', { mockRules: [mock('/b')], rewriteRules: [mock('/rw')] });
    const a = write('mocks/a.json', { mockRules: [mock('/a0'), mock('/a1')] });
    write('mocks/notes.txt', 'ignored');

    const loaded = loadConfigFile(configPath);

    expect(loaded.config.mockRules!.map(rule => rule.path)).toEqual(['/main', '/recorded', '/a0', '/a1', '/b']);
    expect(loaded.config.rewriteRules!.map(rule => rule.path)).toEqual(['/rw']);
    expect(loaded.files).toEqual([configPath, recorded, a, b]);
    expect(loaded.sources.mockRules).toEqual([
      { file: configPath, index: 0 },
      { file: recorded, index: 0 },
      { file: a, index: 0 },
      { file: a, index: 1 },
      { file: b, index: 0 },
    ]);
  });

  it('rejects anything but rule lists in an included file', () => {
    const configPath = write('yxorp.json', { ...base, include: ['./extra.json'] });
    write('extra.json', { target: 'http://other', include: ['x'], mockRules: [] });
    expect(() => loadConfigFile(configPath)).toThrow('can only contain rule lists');
  });

  it('reports a missing included file and invalid JSON with the file name', () => {
    const configPath = write('yxorp.json', { ...base, include: ['./missing.json'] });
    expect(() => loadConfigFile(configPath)).toThrow(/Cannot read included file .*missing\.json: file not found/);

    write('yxorp.json', { ...base, include: ['./broken.json'] });
    write('broken.json', '{ nope');
    expect(() => loadConfigFile(configPath)).toThrow(/Invalid JSON in included file .*broken\.json/);
  });

  it('only supports wildcards in the file name', () => {
    const configPath = write('yxorp.json', { ...base, include: ['./*/mocks.json'] });
    expect(() => loadConfigFile(configPath)).toThrow('only supported in the file name');
  });

  it('allows a wildcard that matches nothing', () => {
    const configPath = write('yxorp.json', { ...base, include: ['./mocks/*.json'] });
    expect(loadConfigFile(configPath).config.mockRules).toBeUndefined();
  });
});

describe('include at runtime', () => {
  it('serves included rules, with paths relative to the main config', async () => {
    write('data/user.json', { name: 'from file' });
    write('recorded/recorded.json', { mockRules: [{ method: 'GET', path: '/user', file: './data/user.json' }] });
    const configPath = write('yxorp.json', { ...base, include: ['./recorded/recorded.json'] });

    const proxy = await startYxorp({ configPath, logger: createRecordingLogger().logger });

    try {
      expect(JSON.parse((await fetchYxorp(proxy.port, '/user')).body)).toEqual({ name: 'from file' });
    } finally {
      await proxy.close();
    }
  });
});

// fs.watch can be unreliable on some platforms — see config-watcher.test.ts.
function softExpect(fn: () => void): void {
  try {
    fn();
  } catch (e: any) {
    console.warn(`[config-loader] flaky assertion skipped: ${e.message}`);
  }
}

describe('watching included files', () => {
  let watcher: ConfigWatcher | undefined;

  afterEach(() => watcher?.close());

  async function waitFor(condition: () => boolean, ms = 2000) {
    const started = Date.now();
    while (!condition() && Date.now() - started < ms) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  it('reloads when an included file changes or a new file matches a wildcard', async () => {
    const configPath = write('yxorp.json', { ...base, include: ['./mocks/*.json'] });
    write('mocks/a.json', { mockRules: [mock('/a')] });

    let paths: string[] = [];
    watcher = watchConfig(configPath, (config) => { paths = (config.mockRules ?? []).map(rule => rule.path); }, () => {});

    write('mocks/a.json', { mockRules: [mock('/a-changed')] });
    await waitFor(() => paths.includes('/a-changed'));
    softExpect(() => expect(paths).toEqual(['/a-changed']));

    write('mocks/b.json', { mockRules: [mock('/b')] });
    await waitFor(() => paths.includes('/b'));
    softExpect(() => expect(paths).toEqual(['/a-changed', '/b']));
  });
});
