import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || 'api';
const entries = readdirSync(root, { recursive: true }).filter(
  (file) =>
    !file.split(path.sep).some((part) => part === '_lib' || part.startsWith('.')) &&
    /\.(js|mjs|cjs|ts|tsx|jsx|py|go|rb)$/.test(file) &&
    !file.endsWith('.d.ts') &&
    statSync(path.join(root, file)).isFile(),
);
console.log(`Deployment function budget: ${entries.length}/12 entry files.`);
if (entries.length > 12) process.exitCode = 1;
