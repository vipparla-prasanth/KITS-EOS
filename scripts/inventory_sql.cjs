const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

// Get git tracked files
let gitTrackedFiles = new Set();
try {
  const trackedOutput = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8' });
  trackedOutput.split('\n').map(l => l.trim()).filter(Boolean).forEach(f => {
    gitTrackedFiles.add(path.normalize(f));
  });
} catch (e) {
  console.error('Error fetching git ls-files:', e.message);
}

function findSqlFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
        results = results.concat(findSqlFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      results.push(fullPath);
    }
  }
  return results;
}

const allSqlFiles = findSqlFiles(rootDir);

const inventory = [];

for (const filePath of allSqlFiles) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const isTracked = gitTrackedFiles.has(path.normalize(relPath));
  const content = fs.readFileSync(filePath, 'utf8');

  // Parse SQL statements
  const creates = [];
  const alters = [];
  const drops = [];
  const indexes = [];
  const policies = [];
  const functions = [];
  const tables = [];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;

    const createTableMatch = trimmed.match(/CREATE\s+(?:TABLE|TABLE\s+IF\s+NOT\s+EXISTS)\s+([a-zA-Z0-9_\.]+)/i);
    if (createTableMatch) tables.push(createTableMatch[1]);

    const createFuncMatch = trimmed.match(/CREATE\s+(?:OR\s+REPLACE\s+FUNCTION|FUNCTION)\s+([a-zA-Z0-9_\.]+)/i);
    if (createFuncMatch) functions.push(createFuncMatch[1]);

    const createIdxMatch = trimmed.match(/CREATE\s+(?:UNIQUE\s+INDEX|INDEX)\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_\.]+)/i);
    if (createIdxMatch) indexes.push(createIdxMatch[1]);

    const createPolicyMatch = trimmed.match(/CREATE\s+POLICY\s+["']?([^"'\s]+)["']?\s+ON\s+([a-zA-Z0-9_\.]+)/i);
    if (createPolicyMatch) policies.push(`${createPolicyMatch[1]} ON ${createPolicyMatch[2]}`);

    const alterMatch = trimmed.match(/ALTER\s+(?:TABLE|FUNCTION|VIEW|INDEX|TYPE)\s+([a-zA-Z0-9_\.]+)/i);
    if (alterMatch) alters.push(alterMatch[1]);

    const dropMatch = trimmed.match(/DROP\s+(?:TABLE|FUNCTION|VIEW|INDEX|TYPE|POLICY)\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_\.]+)/i);
    if (dropMatch) drops.push(dropMatch[1]);
  }

  // Classification
  let category = '';
  let purpose = '';

  const filename = path.basename(filePath);
  if (relPath.startsWith('scripts/qa/')) {
    category = '4. Local-only QA or benchmark script';
    purpose = 'QA bootstrapping, synthetic seed data, or test verification proposal';
  } else if (filename.includes('_rollback.sql')) {
    category = '2. Historical rollback migration';
    purpose = `Rollback script for migration ${filename.replace('_rollback.sql', '')}`;
  } else if (/^\d{3}_/.test(filename)) {
    if (isTracked) {
      category = '1. Historical forward migration (Tracked)';
      purpose = 'Tracked Git migration applied to remote schema';
    } else {
      category = '7. Untracked forward migration (Candidate for ledger reconciliation)';
      purpose = 'Recent local migration (117-134) applied to production or pending QA sync';
    }
  } else {
    category = '5. Standalone or Maintenance script';
    purpose = 'Standalone utility or maintenance script';
  }

  inventory.push({
    relPath,
    filename,
    isTracked,
    category,
    purpose,
    tables: [...new Set(tables)],
    functions: [...new Set(functions)],
    indexes: [...new Set(indexes)],
    policies: [...new Set(policies)],
    alters: [...new Set(alters)],
    drops: [...new Set(drops)],
    lineCount: lines.length,
    byteSize: content.length,
  });
}

// Summary stats
console.log(`Total SQL Files Found: ${inventory.length}`);
const catCounts = {};
for (const item of inventory) {
  catCounts[item.category] = (catCounts[item.category] || 0) + 1;
}
console.log('\nCategory Breakdown:');
for (const [cat, count] of Object.entries(catCounts)) {
  console.log(`  ${cat}: ${count}`);
}

fs.writeFileSync(path.join(__dirname, 'sql_inventory.json'), JSON.stringify(inventory, null, 2));
console.log('\nInventory written to scripts/sql_inventory.json');
