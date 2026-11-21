import assert from 'node:assert/strict';
import test from 'node:test';
import { selectIosSimulator } from '../../scripts/select-ios-simulator.mjs';

const old = '11111111-1111-4111-8111-111111111111';
const current = '22222222-2222-4222-8222-222222222222';
const fixture = () => ({
  runtimes: [
    { name: 'iOS 26.2', version: '26.2', identifier: 'old', isAvailable: true },
    { name: 'iOS 26.5', version: '26.5', identifier: 'current', isAvailable: true },
  ],
  devices: {
    old: [{ name: 'iPhone 17', state: 'Shutdown', isAvailable: true, udid: old }],
    current: [{ name: 'iPhone 17', state: 'Shutdown', isAvailable: true, udid: current }],
  },
});

test('uses the prepared device on the exact SDK runtime, even when an older runtime comes first', () => {
  assert.equal(selectIosSimulator(fixture(), '26.5'), current);
});

test('does not silently substitute unavailable runtimes, another OS or mismatched SDK versions', () => {
  for (const change of [
    (x) => (x.runtimes[1].isAvailable = false),
    (x) => (x.runtimes[1].name = 'watchOS 26.5'),
    (x) => (x.runtimes[1].version = '26.4'),
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => selectIosSimulator(value, '26.5'), /No available iOS runtime/);
  }
  assert.throws(() => selectIosSimulator(fixture(), '25.0'), /iOS 26 SDK/);
});

test('missing, unavailable, already running or wrong-device fixtures fail instead of creating another device', () => {
  for (const change of [
    (x) => (x.devices.current = []),
    (x) => (x.devices.current[0].isAvailable = false),
    (x) => (x.devices.current[0].state = 'Booted'),
    (x) => (x.devices.current[0].name = 'iPad Pro'),
    (x) => (x.devices.current[0].udid = 'not-an-id'),
  ]) {
    const value = fixture();
    change(value);
    assert.throws(() => selectIosSimulator(value, '26.5'), /prepared, shutdown iPhone 17/);
  }
});
