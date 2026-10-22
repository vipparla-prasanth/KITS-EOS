const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

function createSpaServer(distDir, port) {
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
    let reqPath = req.url.split('?')[0].split('#')[0];
    let filePath = path.join(distDir, reqPath);

    // If file exists, serve it
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Otherwise serve index.html (SPA fallback)
    const indexPath = path.join(distDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function runRouteVerification() {
  console.log('====================================================');
  console.log('   END-TO-END DIRECT URL ROUTE & REFRESH VERIFICATION');
  console.log('====================================================\n');

  const adminDist = path.resolve(__dirname, '../apps/admin-coordinator/dist');
  const studentDist = path.resolve(__dirname, '../apps/public-student/dist');

  const adminPort = 4173;
  const studentPort = 4174;

  const adminServer = await createSpaServer(adminDist, adminPort);
  const studentServer = await createSpaServer(studentDist, studentPort);

  console.log(`Local SPA Servers running on:`);
  console.log(` - Admin: http://127.0.0.1:${adminPort}`);
  console.log(` - Student: http://127.0.0.1:${studentPort}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const results = [];

  // 1. Verify Public Student Routes
  const studentRoutes = [
    { name: 'Student Home (Lazy)', path: '/' },
    { name: 'Reset Password (Lazy)', path: '/reset-password' },
    { name: 'About KEOS (Lazy)', path: '/about-keos' },
    { name: 'Assessments Directory (Lazy decoupled)', path: '/assessments' },
    { name: 'Global Leaderboard (Lazy decoupled)', path: '/assessments/leaderboard' },
    { name: 'Verify Certificate', path: '/verify' },
    { name: 'Login Portal', path: '/login' },
  ];

  console.log('--- Testing Public Student Routes ---');
  for (const r of studentRoutes) {
    const page = await context.newPage();
    const url = `http://127.0.0.1:${studentPort}${r.path}`;
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    let status = 'PASSED';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      // Direct Refresh test
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
      const rootExists = await page.$('#root');
      if (!rootExists) status = 'FAILED: #root not found';
      if (errors.length > 0) status = `FAILED: ${errors.join(', ')}`;
    } catch (e) {
      status = `FAILED: ${e.message}`;
    }

    console.log(`  [${status === 'PASSED' ? 'VERIFIED' : 'ISSUE'}] ${r.name.padEnd(35)} -> ${r.path} (Direct & Refresh)`);
    results.push({ app: 'public-student', route: r.path, name: r.name, status });
    await page.close();
  }

  // 2. Verify Admin & Coordinator Routes
  const adminRoutes = [
    { name: 'Admin/Coord Login (Root)', path: '/' },
    { name: 'Admin Login Explicit', path: '/adminlogin' },
    { name: 'Access Denied Page', path: '/access-denied' },
    { name: 'Coordinator Portal (Protected Shell)', path: '/coordinator' },
    { name: 'Coordinator Select (Protected)', path: '/coordinator/select' },
    { name: 'Coordinator Live Host (Protected)', path: '/coordinator/assessment-host' },
    { name: 'Admin Dashboard (Lazy AdminLayout)', path: '/admin' },
    { name: 'Admin Assessments List (Lazy decoupled)', path: '/admin/assessments' },
    { name: 'Admin Assessments Create (Lazy decoupled)', path: '/admin/assessments/new' },
  ];

  console.log('\n--- Testing Admin & Coordinator Routes ---');
  for (const r of adminRoutes) {
    const page = await context.newPage();
    const url = `http://127.0.0.1:${adminPort}${r.path}`;
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    let status = 'PASSED';
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      // Direct Refresh test
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
      const rootExists = await page.$('#root');
      if (!rootExists) status = 'FAILED: #root not found';
      // In unauthenticated state, /admin redirects to / or login, which is correct behavior
      if (errors.length > 0) status = `FAILED: ${errors.join(', ')}`;
    } catch (e) {
      status = `FAILED: ${e.message}`;
    }

    console.log(`  [${status === 'PASSED' ? 'VERIFIED' : 'ISSUE'}] ${r.name.padEnd(42)} -> ${r.path} (Direct & Refresh)`);
    results.push({ app: 'admin-coordinator', route: r.path, name: r.name, status });
    await page.close();
  }

  await browser.close();
  adminServer.close();
  studentServer.close();

  const failed = results.filter(r => r.status !== 'PASSED');
  console.log(`\nRoute Verification Complete. Total: ${results.length}, Passed: ${results.length - failed.length}, Failed: ${failed.length}`);
}

runRouteVerification().catch(err => {
  console.error('Route verification failed:', err);
  process.exit(1);
});
