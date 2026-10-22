import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface VersionInfo {
  version: string;
  buildId: string;
  builtAt: string;
}

/**
 * Resolves the authoritative semantic product version from the repository root.
 * Validates strict semver format and eliminates uninitialized '0.0.0' defaults.
 */
export function resolveAppVersion(projectRoot?: string): VersionInfo {
  const currentDir = import.meta.dirname || path.dirname(new URL(import.meta.url).pathname);
  const rootDir = projectRoot || path.resolve(currentDir, '..');
  const rootPackageJsonPath = path.resolve(rootDir, 'package.json');

  if (!fs.existsSync(rootPackageJsonPath)) {
    throw new Error(`[VersionPlugin] Authoritative root package.json not found at: ${rootPackageJsonPath}`);
  }

  let rootVersion = '3.0.0';
  try {
    const rootPkg = JSON.parse(fs.readFileSync(rootPackageJsonPath, 'utf-8'));
    if (rootPkg.version && typeof rootPkg.version === 'string') {
      rootVersion = rootPkg.version.trim();
    }
  } catch (err) {
    throw new Error(`[VersionPlugin] Failed to read or parse root package.json: ${err}`);
  }

  // Allow CI / build environment override only if it is a valid semver string
  const envVersion = process.env.VITE_APP_VERSION;
  let finalVersion = rootVersion;

  if (envVersion && SEMVER_REGEX.test(envVersion.trim())) {
    finalVersion = envVersion.trim();
  }

  // Strict semantic version validation
  if (!SEMVER_REGEX.test(finalVersion)) {
    throw new Error(
      `[VersionPlugin] Invalid authoritative version "${finalVersion}". Must follow Semantic Versioning (e.g. 3.0.0).`
    );
  }

  if (finalVersion === '0.0.0') {
    throw new Error(
      `[VersionPlugin] Uninitialized default version "0.0.0" detected. Product version must be set in root package.json (e.g. 3.0.0).`
    );
  }

  const buildId = process.env.VITE_APP_BUILD_ID || `${Date.now()}`;
  const builtAt = new Date().toISOString();

  return {
    version: finalVersion,
    buildId,
    builtAt,
  };
}

/**
 * Vite plugin that emits /version.json during production build, defines compile-time
 * constants (__APP_VERSION__, __APP_BUILD_ID__, __APP_BUILT_AT__), and stamps service workers.
 */
export function createVersionManifestPlugin(options?: {
  appDir?: string;
  swCachePrefix?: string;
}): Plugin {
  let resolvedRoot = options?.appDir || '';
  let resolvedOutDir = '';
  let versionInfo: VersionInfo;

  return {
    name: 'kits-eos-version-manifest-plugin',
    enforce: 'post',
    config(userConfig, env) {
      // Find repo root: either from appDir or search upwards from cwd
      const startDir = options?.appDir || userConfig.root || process.cwd();
      let repoRoot = startDir;
      let curr = startDir;
      for (let i = 0; i < 5; i++) {
        const pkgPath = path.resolve(curr, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.workspaces || pkg.name === 'kits-akshar-eos' || pkg.name === 'kits-eos') {
              repoRoot = curr;
              break;
            }
          } catch {
            // continue upwards
          }
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
      }

      versionInfo = resolveAppVersion(repoRoot);

      // In dev mode, use 'dev-build' identifier to prevent false update prompts
      if (env?.command === 'serve') {
        versionInfo.buildId = 'dev-build';
      }

      return {
        define: {
          __APP_VERSION__: JSON.stringify(versionInfo.version),
          __APP_BUILD_ID__: JSON.stringify(versionInfo.buildId),
          __APP_BUILT_AT__: JSON.stringify(versionInfo.builtAt),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/version.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.end(JSON.stringify(versionInfo, null, 2));
          return;
        }
        next();
      });
    },
    configResolved(config) {
      resolvedRoot = config.root;
      resolvedOutDir = path.resolve(config.root, config.build.outDir || 'dist');
    },
    generateBundle() {
      if (!versionInfo) {
        versionInfo = resolveAppVersion();
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify(versionInfo, null, 2),
      });
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        if (!resolvedOutDir && resolvedRoot) {
          resolvedOutDir = path.resolve(resolvedRoot, 'dist');
        }
        if (!resolvedOutDir) return;

        const swDistPath = path.resolve(resolvedOutDir, 'sw.js');
        if (fs.existsSync(swDistPath)) {
          try {
            let swContent = fs.readFileSync(swDistPath, 'utf-8');
            const cachePrefix = options?.swCachePrefix || 'kits-eos';
            
            // Stamp SW header and update CACHE_NAME if present
            if (swContent.includes('CACHE_NAME')) {
              swContent = swContent.replace(
                /const CACHE_NAME = ['"][^'"]+['"];/,
                `const CACHE_NAME = '${cachePrefix}-${versionInfo.buildId}';`
              );
            }
            if (!swContent.startsWith('/* KITS-EOS SW Build:')) {
              swContent =
                `/* KITS-EOS SW Build: ${versionInfo.buildId} | Version: ${versionInfo.version} */\n` +
                swContent;
            }
            fs.writeFileSync(swDistPath, swContent, 'utf-8');
          } catch (err) {
            console.warn('[VersionPlugin] Warning: Unable to stamp dist/sw.js:', err);
          }
        }
      },
    },
  };
}
