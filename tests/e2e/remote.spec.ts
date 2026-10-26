import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const PLAYLIST_URL = 'https://fixtures.example.invalid/lists/sample.m3u';
const cors = { 'Access-Control-Allow-Origin': '*' };

async function serveFixtures(page: Page) {
  const webm = readFileSync(join(FIXTURES, 'media', 'test.webm'));
  await page.route('https://fixtures.example.invalid/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/sample.m3u')) {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'audio/x-mpegurl' }, body: readFileSync(join(FIXTURES, 'sample.m3u'), 'utf8') });
    }
    if (url.pathname.endsWith('/test.webm')) {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'video/webm' }, body: webm });
    }
    return route.fulfill({ status: 404, headers: cors, body: 'not found' });
  });
  await page.route('https://logos.example.invalid/**', (route) => route.fulfill({ status: 404, body: '' }));
}

const focusedId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.focusId ?? document.activeElement?.tagName);

async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

async function openSettingsFromEmptyHome(page: Page) {
  await page.goto('/');
  await expect(page.getByText('No saved channels yet')).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe('BUTTON');
  await press(page, 'Enter');
  await expect.poll(() => focusedId(page)).toBe('set:sample');
}

async function videoState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelectorAll('video');
    return { count: v.length, paused: v[0].paused, time: v[0].currentTime };
  });
}

test('keyboard-only: import, favourite, reorder, play, zap, back, reload', async ({ page }) => {
  await serveFixtures(page);
  await page.goto('/');

  // Empty My Channels → Import source (autofocused).
  await expect(page.getByText('No saved channels yet')).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe('BUTTON');
  await press(page, 'Enter');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Type the playlist URL. Focus moves to the field with arrows from the autofocused quick-import button.
  await expect.poll(() => focusedId(page)).toBe('set:sample');
  await press(page, 'ArrowUp');
  await expect.poll(() => focusedId(page)).toBe('set:url');
  await page.keyboard.type(PLAYLIST_URL);
  await press(page, 'Enter');
  await expect(page.getByText(/Imported 5 channels: 5 new/)).toBeVisible();

  // Back → My Channels → Browse channels.
  await press(page, 'Escape');
  await expect(page.getByRole('heading', { name: 'My Channels' })).toBeVisible();
  await expect.poll(() => focusedId(page)).toBe('BUTTON');
  await press(page, 'Enter');
  await expect(page.getByRole('heading', { name: 'All Channels' })).toBeVisible();

  // Add Alpha, Beta (name contains a comma) and Delta via the ☆ Add action.
  await expect.poll(() => focusedId(page)).toMatch(/^ch:.*\|main$/);
  await press(page, 'ArrowRight');
  await expect.poll(() => focusedId(page)).toMatch(/\|fav$/);
  await press(page, 'Enter');
  await press(page, 'ArrowDown');
  await press(page, 'Enter');
  await press(page, 'ArrowDown', 2);
  await press(page, 'Enter');
  await expect(page.getByRole('button', { name: /Remove .* from My Channels/ })).toHaveCount(3);

  // Search narrows the bounded list and keeps saved state visible.
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowUp', 6);
  await expect.poll(() => focusedId(page)).toBe('all:search');
  await page.keyboard.type('gamma');
  await expect(page.locator('.row')).toHaveCount(1);
  await page.keyboard.press('Control+A');
  await press(page, 'Backspace');
  await expect(page.locator('.row')).toHaveCount(5);

  // Back to My Channels: 3 saved in order Alpha, Beta, Delta.
  await press(page, 'Escape');
  await expect(page.getByText('3 saved')).toBeVisible();
  await expect(page.locator('.row-name')).toHaveText(['Alpha News', 'Beta Sports, Live', 'Delta Broken']);

  // Reorder: Edit order → move Beta up.
  await page.locator('[data-focus-id="my:edit"]').focus();
  await press(page, 'Enter');
  // Spatial navigation from the header's Edit button lands on the nearest row action below it.
  await press(page, 'ArrowDown');
  await expect.poll(() => focusedId(page)).toMatch(/\|(up|down|remove)$/);
  for (let i = 0; i < 3 && !/\|main$/.test(String(await focusedId(page))); i++) await press(page, 'ArrowLeft'); // walk left to the row's main button
  await expect.poll(() => focusedId(page)).toMatch(/\|main$/);
  await press(page, 'ArrowDown'); // Alpha row → Beta row
  await press(page, 'ArrowRight');
  await expect.poll(() => focusedId(page)).toMatch(/\|up$/);
  await press(page, 'Enter');
  await expect(page.locator('.row-name')).toHaveText(['Beta Sports, Live', 'Alpha News', 'Delta Broken']);
  await expect.poll(() => focusedId(page)).toMatch(/\|up$/); // focus follows the moved row
  await page.locator('[data-focus-id="my:edit"]').focus();
  await press(page, 'Enter');

  // Play the first channel with OK. Focus moves, playback starts only on OK.
  await page.locator('.row-main').first().focus();
  expect((await videoState(page)).paused).toBe(true);
  await press(page, 'Enter');
  await expect(page.locator('.overlay-title')).toHaveText('Beta Sports, Live');
  await expect.poll(async () => (await videoState(page)).time, { timeout: 15_000 }).toBeGreaterThan(0.5);

  // Controls auto-hide; OK reveals them without activating Pause.
  await expect(page.locator('.overlay')).toHaveClass(/overlay-hidden/, { timeout: 8000 });
  await press(page, 'Enter');
  await expect(page.locator('.overlay')).not.toHaveClass(/overlay-hidden/);
  expect((await videoState(page)).paused).toBe(false);

  // Next channel follows My Channels order: Alpha.
  await expect.poll(() => focusedId(page)).toBe('pl:play');
  await press(page, 'ArrowRight');
  await expect.poll(() => focusedId(page)).toBe('pl:next');
  await press(page, 'Enter');
  await expect(page.locator('.overlay-title')).toHaveText('Alpha News');

  // Delta is broken → error with Retry focused and Next channel available.
  await press(page, 'Enter');
  await expect(page.locator('.overlay-title')).toHaveText('Delta Broken');
  await expect(page.getByText(/Provider responded HTTP 404/)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => focusedId(page)).toBe('pl:retry');

  // Rapid zapping: only one video element, final selection wins; wrap-around Delta → Beta.
  await page.locator('[data-focus-id="pl:next"]').focus();
  for (let i = 0; i < 4; i++) await press(page, 'Enter');
  // 4 steps from Delta (index 2 of 3): Beta, Alpha, Delta, Beta.
  await expect(page.locator('.overlay-title')).toHaveText('Beta Sports, Live');
  await expect.poll(async () => (await videoState(page)).time, { timeout: 15_000 }).toBeGreaterThan(0.5);
  expect((await videoState(page)).count).toBe(1);

  // Back returns to My Channels with the playing channel focused; playback continues in the mini view.
  await press(page, 'Escape');
  await expect(page.getByRole('heading', { name: 'My Channels' })).toBeVisible();
  await expect(page.locator('.row.is-playing .row-name')).toHaveText('Beta Sports, Live');
  await expect.poll(() => focusedId(page)).toMatch(/\|main$/);
  expect((await videoState(page)).paused).toBe(false);
  await expect(page.locator('[data-focus-id="nav:now"]')).toBeVisible();

  // Reload: favourites and order persist; nothing autoplays.
  await page.reload();
  await expect(page.locator('.row-name')).toHaveText(['Beta Sports, Live', 'Alpha News', 'Delta Broken']);
  expect((await videoState(page)).paused).toBe(true);
  await expect.poll(() => focusedId(page)).toMatch(/^ch:/);
});

test('catalogue importer rejects a single HLS manifest with a helpful message', async ({ page }) => {
  await page.route('https://fixtures.example.invalid/**', (route) =>
    route.fulfill({ status: 200, headers: cors, body: '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n' }),
  );
  await openSettingsFromEmptyHome(page);
  await press(page, 'ArrowUp');
  await page.keyboard.type('https://fixtures.example.invalid/stream.m3u8');
  await press(page, 'Enter');
  await expect(page.getByText(/single HLS stream manifest/)).toBeVisible();
});

test('failed refresh keeps existing channels', async ({ page }) => {
  await serveFixtures(page);
  await openSettingsFromEmptyHome(page);
  await press(page, 'ArrowUp');
  await page.keyboard.type(PLAYLIST_URL);
  await press(page, 'Enter');
  await expect(page.getByText(/Imported 5 channels/)).toBeVisible();
  await page.unroute('https://fixtures.example.invalid/**');
  await page.route('https://fixtures.example.invalid/**', (route) => route.fulfill({ status: 500, headers: cors, body: 'oops' }));
  await page.locator('[data-focus-id="set:refresh"]').focus();
  await press(page, 'Enter');
  await expect(page.getByText(/HTTP 500/)).toBeVisible();
  await expect(page.getByText('Channels', { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('5');
});

test('phone layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
