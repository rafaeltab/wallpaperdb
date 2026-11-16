import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, expect as browserExpect, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

declare global {
  interface Window {
    disposeProjectActivity?: () => void;
  }
}

async function motionPage(browserName: 'chromium' | 'firefox', run: (page: Page) => Promise<void>) {
  const vite = await createServer({ configFile: 'frontend/vite.config.ts', server: { port: 0 } });
  const browser = await (browserName === 'chromium' ? chromium : firefox).launch({
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error('Expected browser origin');
    await page.route('**/__motion_test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<link rel="stylesheet" href="${origin}src/canvas/canvas.css">
          <div class="cc-app cc-highlight-status-glow">
            <span id="initial" class="cc-status cc-status-active">Working<i></i></span>
            <span id="later" class="cc-status">Reviewing<i></i></span>
            <div id="item" class="cc-item cc-active-job" style="left:20px;top:60px;width:384px;height:80px;--cc-status-color:#78c6ab">
              <span>Project item</span>
            </div>
          </div>
          <script type="module">
            import { synchronizeProjectActivity } from '/src/canvas/project-canvas-motion.ts';
            window.disposeProjectActivity = synchronizeProjectActivity(document.querySelector('.cc-app'));
          </script>`,
      })
    );
    await page.goto(`${origin}__motion_test`);
    await browserExpect(page.locator('#initial')).toHaveCSS('animation-duration', '3s');
    await page.waitForFunction(() => !!window.disposeProjectActivity);
    await run(page);
  } finally {
    await browser.close();
    await vite.close();
  }
}

async function changedPixels(page: Page, reference: Buffer, actual: Buffer) {
  return page.evaluate(
    async ([reference, actual]) => {
      async function pixels(base64: string) {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Expected screenshot comparison context');
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        bitmap.close();
        return data;
      }
      const before = await pixels(reference),
        after = await pixels(actual);
      if (before.length !== after.length) throw new Error('Screenshot dimensions changed');
      let changed = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (
          before.slice(i, i + 4).some((value, channel) => Math.abs(value - after[i + channel]) > 1)
        )
          changed++;
      }
      return changed / (before.length / 4);
    },
    [reference.toString('base64'), actual.toString('base64')]
  );
}

it.each(['chromium', 'firefox'] as const)(
  'keeps delayed Project item activity and selected highlights synchronized in %s',
  async (browserName) => {
    await motionPage(browserName, async (page) => {
      expect(
        await page.locator('.cc-app').evaluate((element) => element.getAnimations().length)
      ).toBe(0);
      const epoch = await page
        .locator('#initial')
        .evaluate((element) => Number(element.getAnimations()[0].startTime));
      await page.waitForFunction(() => {
        const animation = document.querySelector('#initial')?.getAnimations()[0];
        return typeof animation?.currentTime === 'number' && animation.currentTime > 300;
      });
      await page.evaluate(() => {
        document.querySelector('#later')?.classList.add('cc-status-active');
        document.querySelector('#item')?.classList.add('cc-selected');
      });
      await browserExpect
        .poll(() =>
          page.locator('.cc-app').evaluate((element) => {
            const animations = element.getAnimations({ subtree: true });
            return (
              animations.length === 3 &&
              Math.max(...animations.map((a) => Number(a.startTime))) -
                Math.min(...animations.map((a) => Number(a.startTime))) <
                0.01
            );
          })
        )
        .toBe(true);
      for (const [phase, expected] of [
        [0, 1],
        [750, 0.91],
        [1500, 0.82],
      ] as const) {
        await page.locator('.cc-app').evaluate((element, phase) => {
          for (const animation of element.getAnimations({ subtree: true })) {
            animation.pause();
            animation.currentTime = phase;
          }
        }, phase);
        await browserExpect
          .poll(() =>
            page.evaluate(() => {
              const initial = document.querySelector('#initial'),
                later = document.querySelector('#later'),
                item = document.querySelector('#item');
              if (!initial || !later || !item) throw new Error('Expected Project item indicators');
              return [
                getComputedStyle(initial).opacity,
                getComputedStyle(later).opacity,
                getComputedStyle(item, '::after').opacity,
              ].map(Number);
            })
          )
          .toEqual([expected, expected, expected]);
        if (process.env.FACTORY_DEMO_DIRECTORY) {
          await mkdir(process.env.FACTORY_DEMO_DIRECTORY, { recursive: true });
          await page.screenshot({
            path: `${process.env.FACTORY_DEMO_DIRECTORY}/activity-${browserName}-${phase}.png`,
          });
        }
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await browserExpect(page.locator('#initial')).toHaveCSS('opacity', '1');
      await browserExpect(page.locator('#later')).toHaveCSS('opacity', '1');
      expect(
        await page
          .locator('.cc-app')
          .evaluate((element) => element.getAnimations({ subtree: true }).length)
      ).toBe(0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await browserExpect(page.locator('#initial')).toHaveCSS('animation-duration', '3s');
      await browserExpect
        .poll(() =>
          page.locator('.cc-app').evaluate((element, epoch) => {
            const animations = element.getAnimations({ subtree: true });
            return (
              animations.length === 3 &&
              animations.every((a) => Math.abs(Number(a.startTime) - epoch) < 0.01)
            );
          }, epoch)
        )
        .toBe(true);
      await page.evaluate(() => window.disposeProjectActivity?.());
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await browserExpect(page.locator('#initial')).toHaveCSS('animation-name', 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await browserExpect
        .poll(() =>
          page.locator('.cc-app').evaluate((element, epoch) => {
            const animations = element.getAnimations({ subtree: true });
            return (
              animations.length === 3 && animations.every((a) => Number(a.startTime) > epoch + 100)
            );
          }, epoch)
        )
        .toBe(true);
    });
  },
  30000
);

it.each(['chromium', 'firefox'] as const)(
  'preserves the inherited activity pulse appearance at fixed phases in %s',
  async (browserName) => {
    await motionPage(browserName, async (page) => {
      await page.evaluate(() => document.querySelector('#item')?.classList.add('cc-selected'));
      await browserExpect
        .poll(() =>
          page.locator('.cc-app').evaluate((element) => {
            const animations = element.getAnimations({ subtree: true });
            return (
              animations.length === 2 &&
              Math.max(...animations.map((a) => Number(a.startTime))) -
                Math.min(...animations.map((a) => Number(a.startTime))) <
                0.01
            );
          })
        )
        .toBe(true);
      await page.evaluate(() => window.disposeProjectActivity?.());
      const freeze = async (phase: number) => {
        await page.locator('.cc-app').evaluate((element, phase) => {
          for (const animation of element.getAnimations({ subtree: true })) {
            animation.pause();
            animation.currentTime = phase;
          }
        }, phase);
      };
      const phases = [0, 750, 1500];
      const optimized = [];
      for (const phase of phases) {
        await freeze(phase);
        optimized.push(await page.screenshot());
      }
      // Reference rendering reproduces the previous inherited clock rather than
      // deriving expected pixels from the replacement animation implementation.
      await page.addStyleTag({
        content: `
        @property --cc-reference-strength { syntax:'<number>'; inherits:true; initial-value:1; }
        @keyframes cc-reference-clock {
          0%,100% { --cc-reference-strength:1; }
          50% { --cc-reference-strength:.82; }
        }
        .cc-app { animation:cc-reference-clock 3s ease-in-out infinite; }
        .cc-status-active,.cc-item.cc-active-job.cc-selected::after {
          animation:none; opacity:var(--cc-reference-strength);
        }
      `,
      });
      for (const [index, phase] of phases.entries()) {
        await freeze(phase);
        const reference = await page.screenshot();
        if (process.env.FACTORY_DEMO_DIRECTORY) {
          await mkdir(process.env.FACTORY_DEMO_DIRECTORY, { recursive: true });
          const directory = process.env.FACTORY_DEMO_DIRECTORY;
          await writeFile(`${directory}/activity-before-${browserName}-${phase}.png`, reference);
          await writeFile(
            `${directory}/activity-after-${browserName}-${phase}.png`,
            optimized[index]
          );
        }
        // Compositor opacity can round colors by one level and change glyph/edge
        // antialiasing in Chromium. Exact opacity is asserted separately.
        expect(
          await changedPixels(page, reference, optimized[index]),
          `Activity pulse pixels at ${phase}ms`
        ).toBeLessThan(0.003);
      }
    });
  },
  30000
);
