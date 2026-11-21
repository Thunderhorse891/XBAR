import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectIosSimulator(inventory, sdk) {
  if (!/^26\.\d+(?:\.\d+)?$/.test(sdk ?? '')) throw new Error('An iOS 26 SDK is required.');
  const runtime = inventory?.runtimes?.find(
    (value) => value.isAvailable === true && value.name.startsWith('iOS ') && value.version === sdk,
  );
  if (!runtime) throw new Error(`No available iOS runtime matches SDK ${sdk}.`);
  const device = inventory.devices?.[runtime.identifier]?.find(
    (value) => value.isAvailable === true && value.name === 'iPhone 17' && value.state === 'Shutdown',
  );
  if (!device || !/^[0-9A-F-]{36}$/i.test(device.udid)) {
    throw new Error('The matching runtime needs a prepared, shutdown iPhone 17 on this fresh CI runner.');
  }
  return device.udid;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(selectIosSimulator(JSON.parse(readFileSync(0, 'utf8')), process.argv[2]));
}
