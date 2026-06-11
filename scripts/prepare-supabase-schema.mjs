import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'supabase', 'production-schema.sql');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const outputPath = path.join(root, 'supabase', 'production-schema.generated.sql');

const schema = await readFile(schemaPath, 'utf8');
const migrationFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
const migrations = await Promise.all(
  migrationFiles.map(async (file) => {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    return `-- Migration: ${file}\n${sql.trim()}`;
  }),
);

const compatibleSchema = schema.replace(
  /create policy if not exists ("[^"]+")\s+on ([^\n;]+)\n/g,
  (_match, policyName, tableName) => `drop policy if exists ${policyName} on ${tableName};\ncreate policy ${policyName}\non ${tableName}\n`,
);

if (compatibleSchema.includes('create policy if not exists')) {
  throw new Error('Unable to convert every unsupported CREATE POLICY IF NOT EXISTS statement.');
}

await writeFile(
  outputPath,
  `${compatibleSchema.trim()}\n\n${migrations.join('\n\n')}\n`,
  'utf8',
);

console.log(`Prepared executable Supabase schema: ${path.relative(root, outputPath)}`);
