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
    /*
     * Migrations are concatenated VERBATIM; only the schema below is rewritten.
     *
     * `create policy if not exists` is not PostgreSQL syntax in any version --
     * production-schema.sql only survives it because of the rewrite that
     * follows. A migration copying that form parses as far as `if` and then
     * fails, taking the rest of the file with it, and nothing here noticed:
     * the guard after the rewrite inspects the schema string alone. Caught by
     * writing exactly that mistake and watching PostgreSQL 16.13 reject it.
     *
     * Comments are stripped first: a migration explaining why it avoids the
     * form would otherwise be refused for naming it, which is how the first
     * version of this guard behaved.
     */
    const executable = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    if (/create\s+policy\s+if\s+not\s+exists/i.test(executable)) {
      throw new Error(
        `${file}: "create policy if not exists" is not valid PostgreSQL and migrations are not rewritten. ` +
          'Use `drop policy if exists "name" on table;` followed by `create policy "name" ...`.',
      );
    }
    return `-- Migration: ${file}\n${sql.trim()}`;
  }),
);

const compatibleSchema = schema.replace(
  /create policy if not exists ("[^"]+")\s+on ([^\n;]+)\n/g,
  (_match, policyName, tableName) =>
    `drop policy if exists ${policyName} on ${tableName};\ncreate policy ${policyName}\non ${tableName}\n`,
);

if (compatibleSchema.includes('create policy if not exists')) {
  throw new Error('Unable to convert every unsupported CREATE POLICY IF NOT EXISTS statement.');
}

await writeFile(outputPath, `${compatibleSchema.trim()}\n\n${migrations.join('\n\n')}\n`, 'utf8');

console.log(`Prepared executable Supabase schema: ${path.relative(root, outputPath)}`);
