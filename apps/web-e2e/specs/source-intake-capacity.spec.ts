import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('retained outcomes allow withdrawal, another Source and replacement without reloading', async ({ page }) => {
  await page.goto('/web/upload');
  const origin = await page.evaluate(() => performance.timeOrigin);
  const sources = page.getByRole('region', { name: 'Create one Wallpaper with multiple Sources', exact: true });
  const input = sources.getByLabel('Choose initial Sources for one Wallpaper');
  const fixture = fileURLToPath(new URL('../fixtures/profile-small.png', import.meta.url));
  await input.setInputFiles(Array(16).fill(fixture));
  const outcomes = sources.getByTestId('source-upload-outcome');
  await expect(outcomes.filter({ hasText: 'Source accepted' })).toHaveCount(16);
  await expect(sources).toContainText('16 accepted Sources.');
  await sources.locator('button[aria-label^="Withdraw Source"]:enabled').first().click();
  await expect(sources).toContainText('15 accepted Sources.');
  await expect(input).toBeEnabled();
  await input.setInputFiles(fixture);
  await expect(outcomes.filter({ hasText: 'Source accepted' })).toHaveCount(17);
  await expect(sources).toContainText('16 accepted Sources.');
  await sources.locator('label').filter({ hasText: /^Replace Source / }).first().locator('input').setInputFiles(fixture);
  await expect(outcomes.filter({ hasText: 'Source accepted' })).toHaveCount(18);
  await expect(sources).toContainText('16 accepted Sources.');
  await expect(input).toBeEnabled();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});
