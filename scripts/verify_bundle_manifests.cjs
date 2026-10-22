const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function verifyApp(appName, distDir) {
  const assetsDir = path.join(distDir, 'assets');
  const indexHtmlPath = path.join(distDir, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // Parse scripts and preloads from index.html
  const scripts = [...indexHtml.matchAll(/<script[^>]+src=["']\/assets\/([^"']+)["']/g)].map(m => m[1]);
  const preloads = [...indexHtml.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']\/assets\/([^"']+)["']/g)].map(m => m[1]);

  const allInitial = [...new Set([...scripts, ...preloads])];

  const initialFiles = [];
  for (const filename of allInitial) {
    const filePath = path.join(assetsDir, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      const raw = content.length;
      const gz = zlib.gzipSync(content).length;
      initialFiles.push({ filename, raw, gz });
    }
  }

  // Check if any assessment, exceljs, or jspdf chunk is in allInitial
  const forbiddenInitial = allInitial.filter(f => 
    f.toLowerCase().includes('excel') || 
    f.toLowerCase().includes('pdf') || 
    f.toLowerCase().includes('assessment')
  );

  // List all chunks in assets
  const files = fs.readdirSync(assetsDir);
  const jsFiles = files.filter(f => f.endsWith('.js'));
  const allChunkStats = jsFiles.map(f => {
    const content = fs.readFileSync(path.join(assetsDir, f));
    return {
      filename: f,
      raw: content.length,
      gz: zlib.gzipSync(content).length,
      isInitial: allInitial.includes(f)
    };
  }).sort((a, b) => b.raw - a.raw);

  return {
    appName,
    scripts,
    preloads,
    allInitial,
    initialFiles,
    forbiddenInitial,
    totalInitialRaw: initialFiles.reduce((sum, f) => sum + f.raw, 0),
    totalInitialGz: initialFiles.reduce((sum, f) => sum + f.gz, 0),
    top10Chunks: allChunkStats.slice(0, 15)
  };
}

const admin = verifyApp('admin-coordinator', path.resolve(__dirname, '../apps/admin-coordinator/dist'));
const student = verifyApp('public-student', path.resolve(__dirname, '../apps/public-student/dist'));

console.log('=== ADMIN-COORDINATOR VERIFICATION ===');
console.log('Scripts:', admin.scripts);
console.log('Preloads:', admin.preloads);
console.log('Forbidden in initial load (excel/pdf/assessment):', admin.forbiddenInitial);
console.log(`Initial Load Total: ${admin.totalInitialRaw} bytes (${(admin.totalInitialRaw/1024).toFixed(2)} kB) | Gzip: ${admin.totalInitialGz} bytes (${(admin.totalInitialGz/1024).toFixed(2)} kB)`);
console.log('\nInitial Files Breakdown:');
admin.initialFiles.forEach(f => console.log(`  - ${f.filename}: ${f.raw} bytes (${(f.raw/1024).toFixed(2)} kB) | gz: ${f.gz} bytes (${(f.gz/1024).toFixed(2)} kB)`));

console.log('\n=== PUBLIC-STUDENT VERIFICATION ===');
console.log('Scripts:', student.scripts);
console.log('Preloads:', student.preloads);
console.log('Forbidden in initial load (excel/pdf/assessment):', student.forbiddenInitial);
console.log(`Initial Load Total: ${student.totalInitialRaw} bytes (${(student.totalInitialRaw/1024).toFixed(2)} kB) | Gzip: ${student.totalInitialGz} bytes (${(student.totalInitialGz/1024).toFixed(2)} kB)`);
console.log('\nInitial Files Breakdown:');
student.initialFiles.forEach(f => console.log(`  - ${f.filename}: ${f.raw} bytes (${(f.raw/1024).toFixed(2)} kB) | gz: ${f.gz} bytes (${(f.gz/1024).toFixed(2)} kB)`));
