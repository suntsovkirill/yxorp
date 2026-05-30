import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveConfig } from '../src/services/config-resolver';

function withTempDir(fn: (dir: string) => void) {
  return () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yxorp-test-'));
    try {
      fn(tmp);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

describe('config-resolver', () => {
  describe('--config flag', () => {
    it('loads config from explicit path', withTempDir((dir) => {
      const configPath = path.join(dir, 'custom.json');
      fs.writeFileSync(configPath, JSON.stringify({ target: 'http://example.com', proxyPort: 3000 }));

      const result = resolveConfig(dir, ['node', 'yxorp', '--config', configPath]);
      expect(result.configDir).toBe(dir);
      expect(result.config.target).toBe('http://example.com');
      expect(result.config.proxyPort).toBe(3000);
    }));

    it('throws when --config path does not exist', withTempDir((dir) => {
      expect(() => resolveConfig(dir, ['node', 'yxorp', '--config', '/nonexistent/path.json']))
        .toThrow('Config file not found');
    }));

    it('parses proxyHeaders from config', withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({
        target: 'http://example.com',
        proxyPort: 3000,
        proxyHeaders: { 'user-agent': 'CustomAgent/1.0', 'x-api-key': 'secret' },
      }));

      const result = resolveConfig(dir, ['node', 'yxorp']);
      expect(result.config.proxyHeaders).toEqual({
        'user-agent': 'CustomAgent/1.0',
        'x-api-key': 'secret',
      });
    }));

    it('resolves relative --config path from cwd', withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'my-config.json'), JSON.stringify({ target: 'http://example.com', proxyPort: 3000 }));

      const result = resolveConfig(dir, ['node', 'yxorp', '--config', 'my-config.json']);
      expect(result.configDir).toBe(dir);
      expect(result.config.target).toBe('http://example.com');
    }));
  });

  describe('yxorp.json in cwd', () => {
    it('loads yxorp.json from current directory', withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({ target: 'http://example.com', proxyPort: 3001 }));

      const result = resolveConfig(dir, ['node', 'yxorp']);
      expect(result.configDir).toBe(dir);
      expect(result.config.proxyPort).toBe(3001);
    }));

    it('prefers yxorp.json over .yxorp/settings.json', withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({ target: 'http://example.com', proxyPort: 3001 }));
      fs.mkdirSync(path.join(dir, '.yxorp'));
      fs.writeFileSync(path.join(dir, '.yxorp', 'settings.json'), JSON.stringify({ target: 'http://other.com', proxyPort: 9999 }));

      const result = resolveConfig(dir, ['node', 'yxorp']);
      expect(result.config.proxyPort).toBe(3001);
    }));
  });

  describe('.yxorp/settings.json', () => {
    it('loads .yxorp/settings.json when no yxorp.json in root', withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, '.yxorp'));
      fs.writeFileSync(path.join(dir, '.yxorp', 'settings.json'), JSON.stringify({ target: 'http://example.com', proxyPort: 3002 }));

      const result = resolveConfig(dir, ['node', 'yxorp']);
      expect(result.configDir).toBe(path.join(dir, '.yxorp'));
      expect(result.config.proxyPort).toBe(3002);
    }));

    it('ignores .yxorp/settings.json when yxorp.json exists in root', withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'yxorp.json'), JSON.stringify({ target: 'http://root.com', proxyPort: 3000 }));
      fs.mkdirSync(path.join(dir, '.yxorp'));
      fs.writeFileSync(path.join(dir, '.yxorp', 'settings.json'), JSON.stringify({ target: 'http://dot.com', proxyPort: 3001 }));

      const result = resolveConfig(dir, ['node', 'yxorp']);
      expect(result.config.target).toBe('http://root.com');
    }));
  });

  describe('no config found', () => {
    it('throws descriptive error', withTempDir((dir) => {
      expect(() => resolveConfig(dir, ['node', 'yxorp']))
        .toThrow(/Config file not found/);
    }));

    it('mentions valid paths in error message', withTempDir((dir) => {
      expect(() => resolveConfig(dir, ['node', 'yxorp']))
        .toThrow(/yxorp\.json|\.yxorp\/settings\.json/);
    }));
  });
});
