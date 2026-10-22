const fs = require('fs');
const path = require('path');

const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

const indexMap = {};

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  // Match CREATE [UNIQUE] INDEX [IF NOT EXISTS] index_name ON table_name (columns) [WHERE predicate]
  const regex = /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_\.]+)\s*(?:USING\s+[a-zA-Z0-9_]+\s*)?\(([^)]+)\)(?:\s+WHERE\s+([^;]+))?/gi;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const isUnique = Boolean(match[1]);
    const indexName = match[2];
    const tableName = match[3].toLowerCase();
    const columns = match[4].split(',').map(c => c.trim().toLowerCase()).join(', ');
    const predicate = match[5] ? match[5].trim().toLowerCase() : null;

    if (!indexMap[tableName]) {
      indexMap[tableName] = [];
    }

    indexMap[tableName].push({
      file,
      indexName,
      isUnique,
      columns,
      predicate,
    });
  }
}

console.log('====================================================');
console.log('       SQL INDEX AUDIT & DUPLICATE DETECTION        ');
console.log('====================================================\n');

let duplicatesFound = 0;

for (const [table, indices] of Object.entries(indexMap)) {
  // Check for duplicates or overlapping definitions
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const idxA = indices[i];
      const idxB = indices[j];

      // Exact match on columns and predicate
      if (idxA.columns === idxB.columns && idxA.predicate === idxB.predicate) {
        console.log(`[EXACT DUPLICATE / RE-CREATION] Table: ${table}`);
        console.log(`  Index A: ${idxA.indexName} (File: ${idxA.file}) -> (${idxA.columns}) ${idxA.predicate ? 'WHERE ' + idxA.predicate : ''}`);
        console.log(`  Index B: ${idxB.indexName} (File: ${idxB.file}) -> (${idxB.columns}) ${idxB.predicate ? 'WHERE ' + idxB.predicate : ''}`);
        console.log('');
        duplicatesFound++;
      } else if (idxA.columns.startsWith(idxB.columns) || idxB.columns.startsWith(idxA.columns)) {
        // Prefix overlap
        console.log(`[PREFIX OVERLAP / REDUNDANT CANDIDATE] Table: ${table}`);
        console.log(`  Index A: ${idxA.indexName} (${idxA.file}) -> (${idxA.columns})`);
        console.log(`  Index B: ${idxB.indexName} (${idxB.file}) -> (${idxB.columns})`);
        console.log('');
      }
    }
  }
}

if (duplicatesFound === 0) {
  console.log('No exact duplicate active indexes found across current migration sequence.');
}
