import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'harbor-jelly.html')).href;

function watchConsole(page) {
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(e.message));
  return problems;
}

async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.__harbor && (window.__harbor.ready || window.__harbor.fallback), null, { timeout: 30_000 });
  return page.evaluate(() => ({ ready: window.__harbor.ready, fallback: window.__harbor.fallback }));
}

async function gpuOrSkip(page) {
  const s = await open(page);
  test.skip(!s.ready, `WebGPU unavailable here: ${s.fallback}`);
}

const hook = (page, fn, arg) => page.evaluate(fn, arg);

test('page chrome renders and the scene runs without console errors', async ({ page }) => {
  const problems = watchConsole(page);
  await gpuOrSkip(page);
  await expect(page.locator('.eyebrow').first()).toHaveText(/material studies/i);
  await expect(page.locator('h1')).toHaveText('Harbor Jelly.');
  await expect(page.locator('#pill-text')).toHaveText('WebGPU · Live');
  await expect(page.locator('.howto')).toContainText('How to play');
  const f0 = await hook(page, () => window.__harbor.frames);
  await page.waitForTimeout(1500);
  const f1 = await hook(page, () => window.__harbor.frames);
  expect(f1 - f0).toBeGreaterThan(20);
  const errors = await hook(page, () => window.__harbor.errors);
  expect(errors).toEqual([]);
  const scroll = await page.evaluate(() => [document.documentElement.scrollHeight <= innerHeight, document.documentElement.scrollWidth <= innerWidth]);
  expect(scroll).toEqual([true, true]);
  await expect(page.locator('#ship-status')).toHaveText(/Unloading \d \/ 8/);
  expect(problems).toEqual([]);
});

test('simulation stays inside its frame budget', async ({ page }) => {
  await gpuOrSkip(page);
  await page.waitForTimeout(2500);
  const sim = await hook(page, () => window.__harbor.simMs);
  expect(sim).toBeLessThan(4);
});

test('controls: horn, feed, flavour, sliders, pause, sound', async ({ page }) => {
  const problems = watchConsole(page);
  await gpuOrSkip(page);
  await page.click('#btn-horn');
  await expect.poll(() => hook(page, () => window.__harbor.horns || 0)).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await page.click('#btn-feed');
  await expect(page.locator('#t-fed')).toHaveText('1');
  await expect.poll(() => hook(page, () => window.__harbor.life().food.length)).toBeGreaterThan(0);
  await page.click('.swatch[data-flavour="blueberry"]');
  await expect(page.locator('.swatch[data-flavour="blueberry"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await hook(page, () => window.__harbor.ui.flavour)).toBe('blueberry');
  await page.locator('#tide').fill('10');
  await expect(page.locator('#tide-v')).toHaveText('+10 cm');
  await expect.poll(() => hook(page, () => window.__harbor.sim.level)).toBeCloseTo(0.1, 3);
  await page.click('#btn-pause');
  await expect(page.locator('#pill-text')).toHaveText('WebGPU · Paused');
  const t0 = await hook(page, () => window.__harbor.core().S.t);
  await page.waitForTimeout(400);
  expect(await hook(page, () => window.__harbor.core().S.t)).toBe(t0);
  await page.click('#btn-pause');
  await page.click('#btn-sound');
  await expect(page.locator('#btn-sound')).toHaveText('Sound off');
  expect(problems).toEqual([]);
});

test('cast off sends the ship, then call her in becomes available', async ({ page }) => {
  await gpuOrSkip(page);
  await expect(page.locator('#btn-ship')).toHaveText('Cast off');
  await page.click('#btn-ship');
  await expect(page.locator('#btn-ship')).toBeDisabled();
  await hook(page, () => { window.__harbor.speed = 8; });
  await expect(page.locator('#ship-status')).toHaveText(/Booms up|Tug coming|Casting off/, { timeout: 30_000 });
  await expect(page.locator('#btn-ship')).toHaveText('Call her in', { timeout: 40_000 });
  await expect(page.locator('#ship-status')).toHaveText(/At sea \d+%/);
  await expect(page.locator('#btn-ship')).toBeEnabled();
  await page.click('#btn-ship');
  await expect(page.locator('#btn-ship')).toBeDisabled();
  await expect(page.locator('#t-voy')).toHaveText('1', { timeout: 40_000 });
  const v = await hook(page, () => window.__harbor.core().collisions());
  expect(v).toEqual([]);
});

test('pointer: waves on water, tipping the block, throwing a lifebuoy, orbit and zoom', async ({ page }) => {
  const problems = watchConsole(page);
  await gpuOrSkip(page);
  const e0 = await hook(page, () => window.__harbor.sim.energy);
  const a = await hook(page, () => window.__harbor.project(-0.6, 0, 1.4));
  const b = await hook(page, () => window.__harbor.project(0.2, 0, 1.0));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await hook(page, () => window.__harbor.sim.energy)).toBeGreaterThan(e0 * 2 + 1e-6);

  const side = await hook(page, () => window.__harbor.project(-0.8, -0.85, 2.6));
  await page.mouse.move(side.x, side.y);
  await page.mouse.down();
  await page.mouse.move(side.x, side.y + 90, { steps: 8 });
  const held = await hook(page, () => window.__harbor.tilt());
  expect(held.held).toBe(true);
  await page.waitForTimeout(200);
  const tt = await hook(page, () => window.__harbor.tilt());
  expect(Math.hypot(tt.x, tt.z)).toBeGreaterThan(0.01);
  await page.mouse.up();
  await page.waitForTimeout(4000);
  const settled = await hook(page, () => window.__harbor.tilt());
  expect(Math.hypot(settled.x, settled.z)).toBeLessThan(0.01);

  const bp = await hook(page, () => { const b = window.__harbor.life().buoys[0]; return window.__harbor.project(b.x, b.y, b.z); });
  await page.mouse.move(bp.x, bp.y);
  await page.mouse.down();
  expect(await hook(page, () => window.__harbor.life().buoys[0].state)).toBe('held');
  await page.mouse.move(bp.x + 80, bp.y + 40, { steps: 6 });
  await page.mouse.up();
  expect(await hook(page, () => window.__harbor.life().buoys[0].state)).toBe('air');
  await expect.poll(() => hook(page, () => window.__harbor.life().buoys[0].state), { timeout: 6000 }).toMatch(/float|land/);

  await page.mouse.move(150, 300);
  await page.mouse.down();
  await page.mouse.move(260, 330, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, 400);
  await page.click('#btn-view');
  expect(problems).toEqual([]);
});

test('reset restores a fresh harbour', async ({ page }) => {
  await gpuOrSkip(page);
  await page.click('#btn-feed');
  await page.click('#btn-reset');
  await expect(page.locator('#t-fed')).toHaveText('0');
  await expect(page.locator('#t-boxes')).toHaveText('0');
});

test('friendly fallback when WebGPU is missing', async ({ page }) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); });
  const s = await open(page);
  expect(s.ready).toBe(false);
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#fallback h2')).toHaveText('The jelly needs WebGPU.');
  await expect(page.locator('#pill-text')).toHaveText('WebGPU · Unavailable');
  expect(problems).toEqual([]);
});

test('fallback when the adapter request fails', async ({ page }) => {
  await page.addInitScript(() => { if (navigator.gpu) navigator.gpu.requestAdapter = async () => null; });
  const s = await open(page);
  expect(s.fallback).toMatch(/adapter/i);
  await expect(page.locator('#fallback')).toBeVisible();
});

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('bottom sheet opens and closes', async ({ page }) => {
    const problems = watchConsole(page);
    await gpuOrSkip(page);
    const panel = page.locator('#panel');
    const closedTop = (await panel.boundingBox()).y;
    await page.click('#sheet-toggle');
    await page.waitForTimeout(500);
    const openTop = (await panel.boundingBox()).y;
    expect(openTop).toBeLessThan(closedTop - 100);
    await page.click('#sheet-toggle');
    expect(problems).toEqual([]);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('runs with reduced motion', async ({ page }) => {
    const problems = watchConsole(page);
    await gpuOrSkip(page);
    await page.waitForTimeout(800);
    expect(problems).toEqual([]);
  });
});
