const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function analyzeApp(appName, distDir) {
  if (!fs.existsSync(distDir)) {
    console.log(`Directory ${distDir} not found.`);
    return null;
  }

  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    console.log(`Assets dir ${assetsDir} not found.`);
    return null;
  }

  const files = fs.readdirSync(assetsDir);
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const cssFiles = files.filter(f => f.endsWith('.css'));

  const fileStats = [];

  for (const f of jsFiles) {
    const fullPath = path.join(assetsDir, f);
    const content = fs.readFileSync(fullPath);
    const rawSize = content.length;
    const gzipSize = zlib.gzipSync(content).length;

    // Detect imported chunks (e.g., from "./chunk-xyz.js" or dynamic import("./chunk-xyz.js"))
    const contentStr = content.toString('utf8');
    const importMatches = [...contentStr.matchAll(/from\s*["']\.\/([^"']+)["']/g)].map(m => m[1]);
    const dynamicMatches = [...contentStr.matchAll(/import\(\s*["']\.\/([^"']+)["']\s*\)/g)].map(m => m[1]);

    fileStats.push({
      name: f,
      rawSize,
      gzipSize,
      imports: [...new Set(importMatches)],
      dynamicImports: [...new Set(dynamicMatches)],
    });
  }

  fileStats.sort((a, b) => b.rawSize - a.rawSize);

  // Check index.html to find entry point
  const indexPath = path.join(distDir, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const entryMatches = [...indexHtml.matchAll(/<script[^>]+src=["']\/assets\/([^"']+)["']/g)].map(m => m[1]);
  const preloadMatches = [...indexHtml.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']\/assets\/([^"']+)["']/g)].map(m => m[1]);

  return {
    appName,
    totalJsFiles: jsFiles.length,
    totalCssFiles: cssFiles.length,
    entryFiles: entryMatches,
    preloadFiles: preloadMatches,
    top10Files: fileStats.slice(0, 15),
    allFiles: fileStats,
  };
}

const apps = [
  { name: 'admin-coordinator', path: path.join(__dirname, '../apps/admin-coordinator/dist') },
  { name: 'public-student', path: path.join(__dirname, '../apps/public-student/dist') },
  { name: 'fallback', path: path.join(__dirname, '../apps/fallback/dist') }
];

console.log('====================================================');
console.log('       KITS-EOS V3 BUNDLE AUDIT BASELINE REPORT      ');
console.log('====================================================\n');

for (const app of apps) {
  const result = analyzeApp(app.name, app.path);
  if (!result) continue;

  console.log(`--- [${result.appName.toUpperCase()}] ---`);
  console.log(`Total JS Chunks: ${result.totalJsFiles}`);
  console.log(`Entry Script: ${result.entryFiles.join(', ')}`);
  console.log(`Preloaded Modules: ${result.preloadFiles.join(', ')}`);

  // Calculate critical initial load footprint
  let initialRaw = 0;
  let initialGzip = 0;
  const criticalFiles = [...new Set([...result.entryFiles, ...result.preloadFiles])];
  for (const cf of criticalFiles) {
    const fStat = result.allFiles.find(f => f.name === cf);
    if (fStat) {
      initialRaw += fStat.rawSize;
      initialGzip += fStat.gzipSize;
    }
  }
  console.log(`CRITICAL INITIAL JS: ${(initialRaw / 1024).toFixed(2)} kB (gzip: ${(initialGzip / 1024).toFixed(2)} kB) across ${criticalFiles.length} files`);

  console.log('\nTop 10 Largest Chunks:');
  for (const f of result.top10Files.slice(0, 10)) {
    const isCritical = criticalFiles.includes(f.name) ? ' [CRITICAL-ENTRY]' : '';
    console.log(`  - ${f.name.padEnd(42)} ${(f.rawSize / 1024).toFixed(2).padStart(8)} kB │ gzip: ${(f.gzipSize / 1024).toFixed(2).padStart(7)} kB${isCritical}`);
  }
  console.log('\n');
}
