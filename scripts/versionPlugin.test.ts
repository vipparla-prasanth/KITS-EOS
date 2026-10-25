import { describe, it, expect } from 'vitest';
import { resolveAppVersion, SEMVER_REGEX, createVersionManifestPlugin } from './versionPlugin.mts';
import path from 'node:path';

describe('Version Plugin & Version Resolution', () => {
  it('validates standard semantic version regex pattern', () => {
    expect(SEMVER_REGEX.test('3.0.0')).toBe(true);
    expect(SEMVER_REGEX.test('3.1.2')).toBe(true);
    expect(SEMVER_REGEX.test('4.0.0-beta.1')).toBe(true);
    expect(SEMVER_REGEX.test('10.20.30+build.1')).toBe(true);

    expect(SEMVER_REGEX.test('3.0')).toBe(false);
    expect(SEMVER_REGEX.test('v3.0.0')).toBe(false); // regex expects numeric prefix
    expect(SEMVER_REGEX.test('invalid')).toBe(false);
  });

  it('resolves authoritative 3.0.0 product version from root package.json', () => {
    const rootDir = path.resolve(__dirname, '..');
    const info = resolveAppVersion(rootDir);

    expect(info.version).toBe('3.0.0');
    expect(typeof info.buildId).toBe('string');
    expect(info.buildId.length).toBeGreaterThan(0);
    expect(typeof info.builtAt).toBe('string');
    expect(new Date(info.builtAt).getTime()).not.toBeNaN();
  });

  it('generates consistent Vite define constants and plugin hooks', () => {
    const plugin = createVersionManifestPlugin({
      appDir: path.resolve(__dirname, '../apps/public-student'),
      swCachePrefix: 'kits-eos-test',
    });

    expect(plugin.name).toBe('kits-eos-version-manifest-plugin');
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin.generateBundle).toBe('function');
    const closeBundleHandler = typeof plugin.closeBundle === 'function' ? plugin.closeBundle : (plugin.closeBundle as any)?.handler;
    expect(typeof closeBundleHandler).toBe('function');

    const config = (plugin.config as any)();
    expect(config.define.__APP_VERSION__).toBe(JSON.stringify('3.0.0'));
    expect(config.define.__APP_BUILD_ID__).toBeTruthy();
  });
});
