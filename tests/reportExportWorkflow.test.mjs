import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes } from './helpers/recordWorkflowHarness.mjs';

const modules = {
  '@/store/useUpgradeStore': `export const requestFeatureUpgrade=(feature)=>f.calls.push(['upgrade',feature]);`,
  '@/lib/ranchReportExport': `export const downloadRanchReportPdf=(...args)=>f.exportFile('pdf',...args);
    export const downloadRanchReportCsv=(...args)=>f.exportFile('csv',...args);`,
};
async function fixture(tier = 'Professional') {
  const f = await renderRoute('Reports', { subscription: { tier } }, '', { modules });
  f.exports = [];
  f.exportFile = (format, ...args) => {
    f.exports.push({ format, args });
    return f.result ?? { ok: true, via: 'browser' };
  };
  return f;
}
const button = (f, label) => {
  const found = nodes(f.tree, (n) => n.type === 'button' && n.props.children === label);
  assert.equal(found.length, 1, `Expected button: ${label}`);
  return found[0].props;
};
const toasts = (f) => f.calls.filter(([kind]) => kind === 'toast').map(([, value]) => value);
const labels = { pdf: 'Download PDF report', csv: 'Export spreadsheet' };
const busyLabels = { pdf: 'Creating PDF…', csv: 'Creating spreadsheet…' };

for (const format of ['pdf', 'csv']) {
  test(`${format}: synchronous repeat and cross-format clicks start only one export`, async () => {
    const f = await fixture();
    let settle;
    f.result = new Promise((resolve) => (settle = resolve));
    const selected = button(f, labels[format]);
    const otherFormat = format === 'pdf' ? 'csv' : 'pdf';
    const other = button(f, labels[otherFormat]);
    const work = selected.onClick();
    // Before React can render a disabled button, the handler itself must refuse.
    const repeated = selected.onClick();
    const crossed = other.onClick();
    try {
      assert.equal(f.exports.length, 1);
      assert.equal(f.exports[0].format, format);
      f.render();
      assert.equal(button(f, busyLabels[format]).disabled, true);
      assert.equal(button(f, busyLabels[format])['aria-busy'], true);
      assert.equal(button(f, labels[otherFormat]).disabled, true);
      assert.equal(button(f, labels[otherFormat])['aria-busy'], false);
      await button(f, labels[otherFormat]).onClick();
      assert.equal(f.exports.length, 1, 'Cross-format click after rerender is still refused');
    } finally {
      settle({ ok: true, via: 'browser' });
      await Promise.all([work, repeated, crossed]);
    }
    f.render();
    assert.equal(button(f, labels[format]).disabled, false);
    assert.equal(button(f, labels[otherFormat]).disabled, false);
    assert.deepEqual(toasts(f), [], 'Initiated download is not a confirmed completed save');
  });

  for (const failure of ['throw', 'rejection']) {
    test(`${format}: ${failure} is explained and can be retried`, async () => {
      const f = await fixture();
      f.exportFile = () => {
        if (failure === 'rejection') return Promise.reject(new Error('Synthetic export failure'));
        throw new Error('Synthetic export failure');
      };
      await button(f, labels[format]).onClick();
      f.render();
      assert.equal(button(f, labels[format]).disabled, false);
      assert.equal(toasts(f).length, 1);
      assert.equal(toasts(f)[0].tone, 'warning');
      assert.equal(
        toasts(f)[0].title,
        format === 'pdf' ? 'Report could not be created' : 'Spreadsheet could not be created',
      );
      assert.match(toasts(f)[0].message, /try again/i);
      f.exportFile = async () => {
        f.exports.push(format);
        return { ok: true, via: 'share-sheet' };
      };
      await button(f, labels[format]).onClick();
      assert.equal(f.exports.length, 1);
      assert.equal(toasts(f).length, 1);
    });
  }

  test(`${format}: cancellation and device failures retain their reason and unlock retry`, async () => {
    const f = await fixture();
    for (const reason of ['Export cancelled — nothing was saved.', 'The file could not be shared from this device.']) {
      f.result = { ok: false, reason };
      await button(f, labels[format]).onClick();
      f.render();
      assert.equal(button(f, labels[format]).disabled, false);
      assert.deepEqual(toasts(f).at(-1), {
        title: format === 'pdf' ? 'Report was not saved' : 'Spreadsheet was not saved',
        message: reason,
        tone: 'warning',
      });
    }
    f.result = { ok: true, via: 'browser' };
    await button(f, labels[format]).onClick();
    assert.equal(f.exports.length, 3);
    assert.equal(toasts(f).length, 2);
  });
}

test('Free and Starter have no export controls; paid tiers retain both formats', async () => {
  for (const tier of ['Free', 'Starter', 'Professional', 'Ranch Ops', 'Enterprise']) {
    const f = await fixture(tier);
    const controls = nodes(f.tree, (n) => n.type === 'button' && Object.values(labels).includes(n.props.children));
    assert.equal(controls.length, ['Free', 'Starter'].includes(tier) ? 0 : 2);
    assert.equal(f.exports.length, 0);
  }
});

test('PDF keeps presentation options and both formats use a fresh report at click time', async () => {
  const f = await fixture('Ranch Ops');
  const accent = nodes(f.tree, (n) => n.type === 'input' && n.props.type === 'color')[0];
  accent.props.onChange({ target: { value: '#000000' } });
  f.render();
  const oldName = f.state.horses[0].name;
  f.state.horses[0].name = 'Updated before export';
  await button(f, labels.pdf).onClick();
  await button(f, labels.csv).onClick();
  assert.equal(f.exports[0].args[2].tier, 'Ranch Ops');
  assert.equal(f.exports[0].args[2].options.accent, '#000000');
  assert.equal(f.exports[0].args[2].profile, f.state.workspaceProfile);
  assert.equal(f.exports[1].args.length, 2, 'CSV retains original data-only interface');
  for (const entry of f.exports) {
    assert.ok(JSON.stringify(entry.args[0]).includes('Updated before export'));
    assert.ok(!JSON.stringify(entry.args[0]).includes(oldName));
  }
});
