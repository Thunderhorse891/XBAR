import { expect, test } from '@playwright/test';

for (const { size, quality } of [
  { size: 512, quality: 0.8 },
  { size: 1024, quality: 0.2 },
]) {
  test(`a valid ${size}px photographic JPEG remains a bounded sanitized JPEG`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(
      async ({ size, quality }) => {
        const uploadPath = '/src/lib/ranchLogoUpload.ts';
        const brandingPath = '/api/_lib/packet-branding.js';
        const { readRanchLogo } = await import(/* @vite-ignore */ uploadPath);
        const { MAX_PACKET_LOGO_BYTES, validatePacketLogo } = await import(/* @vite-ignore */ brandingPath);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const context = canvas.getContext('2d')!;
        const pixels = context.createImageData(size, size);
        let seed = 123456789;
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          for (let channel = 0; channel < 3; channel += 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels.data[offset + channel] = seed >>> 24;
          }
          pixels.data[offset + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        const metadata = 'XBAR-private-logo-comment';
        const rawJpeg = atob(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
        // A valid JPEG comment must be stripped by the raster re-encode.
        const source = `data:image/jpeg;base64,${btoa(
          rawJpeg.slice(0, 2) + String.fromCharCode(255, 254, 0, metadata.length + 2) + metadata + rawJpeg.slice(2),
        )}`;
        const input = validatePacketLogo(source);
        const image = new Image();
        image.src = source;
        await image.decode();
        context.drawImage(image, 0, 0);
        const pngBytes = atob(canvas.toDataURL('image/png').split(',')[1]).length;
        const defaultJpegBytes = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]).length;
        const bytes = Uint8Array.from(atob(source.split(',')[1]), (value) => value.charCodeAt(0));
        let output;
        let error;
        try {
          output = validatePacketLogo(await readRanchLogo(new File([bytes], 'photo.jpg', { type: 'image/jpeg' })));
        } catch (failure) {
          error = failure instanceof Error ? failure.message : String(failure);
        }
        return {
          source,
          metadataRemoved: output && !atob(output.dataUrl.split(',')[1]).includes(metadata),
          limit: MAX_PACKET_LOGO_BYTES,
          inputBytes: input.bytes.length,
          pngBytes,
          defaultJpegBytes,
          error,
          output: output && {
            mimeType: output.mimeType,
            bytes: output.bytes.length,
            width: output.width,
            height: output.height,
          },
        };
      },
      { size, quality },
    );
    expect(result.inputBytes).toBeLessThanOrEqual(result.limit);
    expect(result.pngBytes).toBeGreaterThan(result.limit);
    if (size === 1024) expect(result.defaultJpegBytes).toBeGreaterThan(result.limit);
    expect(result.error).toBeUndefined();
    expect(result.metadataRemoved).toBe(true);
    expect(result.output).toMatchObject({ mimeType: 'image/jpeg', width: size, height: size });
    expect(result.output!.bytes).toBeLessThanOrEqual(result.limit);
    if (size === 512) {
      // Exercise the actual file picker, draft preview, persistence, and reload.
      await page.addInitScript(() => window.localStorage.setItem('xbar-command-center-entry', 'true'));
      await page.goto('/app/setup');
      await page.getByPlaceholder('XBAR LLC').fill('Cedar Creek LLC');
      await page.getByPlaceholder('Primary Ranch').fill('Cedar Creek Ranch');
      await page.getByPlaceholder('Ranch manager').fill('Ranch Manager');
      await page.getByPlaceholder('ops@yourranch.com').fill('office@cedar.example');
      await page.getByRole('button', { name: 'Create workspace' }).click();
      await expect(page).toHaveURL(/\/app$/);
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByLabel('Ranch logo').setInputFiles({
        name: 'photographic-logo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(result.source.split(',')[1], 'base64'),
      });
      const preview = page.getByRole('img', { name: 'Ranch logo preview' });
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
      const savedLogo = await preview.getAttribute('src');
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
      await page.reload();
      await expect(preview).toHaveAttribute('src', savedLogo!);
    }
  });
}

test('PNG normalization retains transparency and rejects oversized encoded output', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const uploadPath = '/src/lib/ranchLogoUpload.ts';
    const brandingPath = '/api/_lib/packet-branding.js';
    const { readRanchLogo } = await import(/* @vite-ignore */ uploadPath);
    const { MAX_PACKET_LOGO_BYTES, validatePacketLogo } = await import(/* @vite-ignore */ brandingPath);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#123456';
    context.fillRect(8, 0, 8, 16);
    const source = canvas.toDataURL('image/png');
    const bytes = Uint8Array.from(atob(source.split(',')[1]), (value) => value.charCodeAt(0));
    const file = new File([bytes], 'transparent.png', { type: 'image/png' });
    const output = validatePacketLogo(await readRanchLogo(file));
    const image = new Image();
    image.src = output.dataUrl;
    await image.decode();
    context.clearRect(0, 0, 16, 16);
    context.drawImage(image, 0, 0);
    const alpha = context.getImageData(0, 0, 1, 1).data[3];
    const original = HTMLCanvasElement.prototype.toDataURL;
    let error;
    try {
      // A browser encoder must never bypass the stored-raster byte bound.
      HTMLCanvasElement.prototype.toDataURL = () =>
        `data:image/png;base64,${btoa('x'.repeat(MAX_PACKET_LOGO_BYTES + 1))}`;
      await readRanchLogo(file);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original;
    }
    return { mimeType: output.mimeType, alpha, error };
  });
  expect(result.mimeType).toBe('image/png');
  expect(result.alpha).toBe(0);
  expect(result.error).toContain('under 256 KB');
});

test('JPEG encoding fails closed when every quality is oversized or the raster is malformed', async ({ page }) => {
  await page.goto('/');
  const errors = await page.evaluate(async () => {
    const uploadPath = '/src/lib/ranchLogoUpload.ts';
    const brandingPath = '/api/_lib/packet-branding.js';
    const { readRanchLogo } = await import(/* @vite-ignore */ uploadPath);
    const { MAX_PACKET_LOGO_BYTES } = await import(/* @vite-ignore */ brandingPath);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const source = canvas.toDataURL('image/jpeg');
    const bytes = Uint8Array.from(atob(source.split(',')[1]), (value) => value.charCodeAt(0));
    const file = new File([bytes], 'small.jpg', { type: 'image/jpeg' });
    const original = HTMLCanvasElement.prototype.toDataURL;
    const errors: string[] = [];
    try {
      for (const output of [
        `data:image/jpeg;base64,${btoa('x'.repeat(MAX_PACKET_LOGO_BYTES + 1))}`,
        `data:image/jpeg;base64,${btoa('not a JPEG')}`,
      ]) {
        HTMLCanvasElement.prototype.toDataURL = () => output;
        try {
          await readRanchLogo(file);
          errors.push('accepted invalid output');
        } catch (failure) {
          errors.push(failure instanceof Error ? failure.message : String(failure));
        }
      }
    } finally {
      HTMLCanvasElement.prototype.toDataURL = original;
    }
    return errors;
  });
  expect(errors).toHaveLength(2);
  for (const error of errors) expect(error).toContain('Choose a valid PNG or JPEG');
});
