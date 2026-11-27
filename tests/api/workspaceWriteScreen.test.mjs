import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const fixture = {
  cloud: {
    status: 'signed-in',
    session: { user: { id: 'user' } },
    workspaceId: 'ranch',
    autosaveReady: true,
    autosaveUnlocked: true,
    workspaceRole: 'Admin',
  },
  owner: 'ranch',
  pathname: '/horses',
};
globalThis.__writeScreen = fixture;
const result = await build({
  entryPoints: ['src/components/RequireWorkspaceWrites.tsx'],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
  plugins: [
    {
      name: 'controlled-screen',
      setup(b) {
        b.onResolve({ filter: /^(react(?:-router-dom|\/jsx-runtime)?$|@\/|.*\.css$)/ }, ({ path }) =>
          path === '@/lib/workspaceWriteGate' ? undefined : { path, namespace: 'fixture' },
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
          const sources = {
            'react/jsx-runtime':
              'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";',
            'react-router-dom': 'export const Link="link";export const useLocation=()=>({pathname:f.pathname});',
            '@/components/BrandMark': 'export const XbarMark="brand";',
            '@/lib/recordsOwner': 'export const readRecordsOwner=()=>f.owner;',
            '@/store/useCloudStore': 'export const useCloudStore=()=>f.cloud;',
          };
          if (path.endsWith('.css')) return { contents: '' };
          if (!sources[path]) throw new Error(`Uncontrolled import: ${path}`);
          return { contents: 'const f=globalThis.__writeScreen;' + sources[path] };
        });
      },
    },
  ],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
const render = () => mod.exports.RequireWorkspaceWrites({ children: 'editable-workflow' });
test('screen hides all entry surfaces during reconciliation and conflict, with explicit recovery routes', () => {
  fixture.cloud.autosaveReady = false;
  let text = JSON.stringify(render());
  assert.doesNotMatch(text, /editable-workflow/);
  assert.match(text, /Checking ranch connection/);
  fixture.cloud.autosaveReady = true;
  fixture.cloud.autosaveUnlocked = false;
  text = JSON.stringify(render());
  assert.doesNotMatch(text, /editable-workflow/);
  assert.match(text, /Open Settings/);
  assert.match(text, /does not replace or upload records/);
  fixture.pathname = '/settings';
  assert.match(JSON.stringify(render()), /editable-workflow/, 'existing recovery/export/account page stays reachable');
});
test('the ready and offline same-ranch screen renders, but a missing binding does not', () => {
  fixture.pathname = '/documents';
  fixture.cloud.autosaveUnlocked = true;
  fixture.cloud.syncState = 'error';
  assert.match(JSON.stringify(render()), /editable-workflow/);
  fixture.owner = '';
  assert.doesNotMatch(JSON.stringify(render()), /editable-workflow/);
  fixture.cloud.session = null;
  fixture.cloud.status = 'signed-out';
  assert.match(JSON.stringify(render()), /editable-workflow/, 'intentional device-only entry remains available');
});
