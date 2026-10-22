const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('@playwright/test');

function createCompressingSpaServer(distDir, port) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0].split('#')[0].replace(/^\/+/, '');
    let filePath = path.join(distDir, reqPath);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(distDir, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);

    // Gzip text / js / css
    if (contentType.includes('javascript') || contentType.includes('html') || contentType.includes('css')) {
      const gzipped = zlib.gzipSync(content);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
      });
      res.end(gzipped);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function measureRoute(browser, port, routePath) {
  const page = await browser.newPage();
  const responses = [];

  page.on('response', (response) => {
    const url = response.url();
    if (response.request().resourceType() === 'script' || url.includes('.js')) {
      responses.push(response);
    }
  });

  await page.goto(`http://127.0.0.1:${port}${routePath}`, { waitUntil: 'networkidle', timeout: 15000 });

  const jsTransferred = [];
  for (const resp of responses) {
    try {
      const url = resp.url();
      const buffer = await resp.body();
      const headers = resp.headers();
      const contentEncoding = headers['content-encoding'] || 'none';
      const uncompressedSize = contentEncoding === 'gzip' ? zlib.gunzipSync(buffer).length : buffer.length;
      const transferredBytes = buffer.length;

      const filename = path.basename(url.split('?')[0]);
      jsTransferred.push({
        filename,
        url,
        rawBytes: uncompressedSize,
        transferredBytes,
        encoding: contentEncoding
      });
    } catch (e) {
      // response might be empty or redirected
    }
  }

  await page.close();

  const totalRaw = jsTransferred.reduce((sum, item) => sum + item.rawBytes, 0);
  const totalTransferred = jsTransferred.reduce((sum, item) => sum + item.transferredBytes, 0);

  const hasExcel = jsTransferred.some(item => item.filename.toLowerCase().includes('excel'));
  const hasPdf = jsTransferred.some(item => item.filename.toLowerCase().includes('pdf'));

  return {
    routePath,
    totalRaw,
    totalTransferred,
    jsTransferred,
    hasExcel,
    hasPdf
  };
}

async function runMeasurements() {
  const adminDist = path.resolve(__dirname, '../apps/admin-coordinator/dist');
  const studentDist = path.resolve(__dirname, '../apps/public-student/dist');

  const adminServer = await createCompressingSpaServer(adminDist, 5183);
  const studentServer = await createCompressingSpaServer(studentDist, 5184);

  const browser = await chromium.launch({ headless: true });

  console.log('====================================================');
  console.log('   PRODUCTION BROWSER TRANSFER MEASUREMENTS (GZIP)  ');
  console.log('====================================================\n');

  // 1. Student Home
  const studentHome = await measureRoute(browser, 5184, '/');
  console.log(`[STUDENT HOME: /]`);
  console.log(`  Raw JS: ${(studentHome.totalRaw / 1024).toFixed(2)} kB (${studentHome.totalRaw} bytes)`);
  console.log(`  Transferred (Wire): ${(studentHome.totalTransferred / 1024).toFixed(2)} kB (${studentHome.totalTransferred} bytes)`);
  console.log(`  ExcelJS Present: ${studentHome.hasExcel} | jsPDF Present: ${studentHome.hasPdf}`);
  console.log('  Chunks:');
  studentHome.jsTransferred.forEach(c => console.log(`    - ${c.filename.padEnd(38)} Raw: ${(c.rawBytes/1024).toFixed(2).padStart(7)} kB │ Wire: ${(c.transferredBytes/1024).toFixed(2).padStart(7)} kB`));

  // 2. Student Login
  const studentLogin = await measureRoute(browser, 5184, '/login');
  console.log(`\n[STUDENT LOGIN: /login]`);
  console.log(`  Raw JS: ${(studentLogin.totalRaw / 1024).toFixed(2)} kB (${studentLogin.totalRaw} bytes)`);
  console.log(`  Transferred (Wire): ${(studentLogin.totalTransferred / 1024).toFixed(2)} kB (${studentLogin.totalTransferred} bytes)`);
  console.log(`  ExcelJS Present: ${studentLogin.hasExcel} | jsPDF Present: ${studentLogin.hasPdf}`);

  // 3. Student Assessment Directory (Incremental load)
  const studentAssessments = await measureRoute(browser, 5184, '/assessments');
  console.log(`\n[STUDENT ASSESSMENTS: /assessments]`);
  console.log(`  Raw JS: ${(studentAssessments.totalRaw / 1024).toFixed(2)} kB (${studentAssessments.totalRaw} bytes)`);
  console.log(`  Transferred (Wire): ${(studentAssessments.totalTransferred / 1024).toFixed(2)} kB (${studentAssessments.totalTransferred} bytes)`);
  console.log(`  ExcelJS Present: ${studentAssessments.hasExcel} | jsPDF Present: ${studentAssessments.hasPdf}`);

  // 4. Admin Login
  const adminLogin = await measureRoute(browser, 5183, '/');
  console.log(`\n[ADMIN/COORD LOGIN: /]`);
  console.log(`  Raw JS: ${(adminLogin.totalRaw / 1024).toFixed(2)} kB (${adminLogin.totalRaw} bytes)`);
  console.log(`  Transferred (Wire): ${(adminLogin.totalTransferred / 1024).toFixed(2)} kB (${adminLogin.totalTransferred} bytes)`);
  console.log(`  ExcelJS Present: ${adminLogin.hasExcel} | jsPDF Present: ${adminLogin.hasPdf}`);
  console.log('  Chunks:');
  adminLogin.jsTransferred.forEach(c => console.log(`    - ${c.filename.padEnd(38)} Raw: ${(c.rawBytes/1024).toFixed(2).padStart(7)} kB │ Wire: ${(c.transferredBytes/1024).toFixed(2).padStart(7)} kB`));

  await browser.close();
  adminServer.close();
  studentServer.close();
}

runMeasurements().catch(console.error);
