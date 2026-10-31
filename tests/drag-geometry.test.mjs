// Run locally after cloning: node --test tests/drag-geometry.test.mjs
// Verifies drag-hit behavior across v0.36 stable and subsequent previews.
// This file does not access customers, the network, or external services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePaths = ['index.html', 'preview/v0.36-mobile-drag.html', 'preview/v0.37-booking.html', 'preview/v0.38-accounting.html', 'preview/v0.39-register.html', 'preview/v0.40-register-period.html', 'preview/v0.41-clarity.html', 'preview/v0.42-booking-customer.html', 'preview/v0.43-full-redesign.html', 'preview/v0.44-booking-to-checkout.html'];
const read = path => readFileSync(resolve(root, path), 'utf8');
const sources = sourcePaths.map(path => ({ path, html: read(path) }));

function between(source, start, next) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, 'Missing function: ' + start);
  const b = source.indexOf(next, a + start.length);
  assert.notEqual(b, -1, 'Missing following function: ' + next);
  return source.slice(a, b);
}
function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}
function hash(text) {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}
function makeHitTest(html, width, scroll) {
  const q = width <= 550 ? 42 : 46;
  const label = width <= 550 ? 93 : 115;
  const clip = { left: 12, right: width - 12, top: 200, bottom: 590 };
  const cellLeft = clip.left + label - scroll;
  const lane = {
    dataset: { staff: 's1' },
    getBoundingClientRect() {
      return { left: cellLeft, right: cellLeft + 36 * q, top: 332, bottom: 438, width: 36 * q };
    },
    parentElement: {
      querySelector() {
        return { getBoundingClientRect() { return { right: clip.left + label }; } };
      }
    }
  };
  const el = {
    parentElement: { getBoundingClientRect() { return clip; } },
    querySelectorAll() { return [lane]; }
  };
  const sandbox = {
    $: id => id === 'staffSchedule' ? el : null,
    window: { matchMedia() { return { matches: width <= 550 }; } }
  };
  const functions =
    between(html, 'function quickTimeFromPoint(', 'function renderQuickSelection(') +
    between(html, 'function quickDropFromPoint(', 'function quickChipEvents(');
  const drop = runInNewContext(functions + '\nquickDropFromPoint;', sandbox);
  return { q, label, clip, cellLeft, drop };
}

test('booking core remains identical across stable and all previews', () => {
  const original = inlineScripts(sources[0].html);
  assert.equal(original.length, 2);
  for (const { path, html } of sources.slice(1)) {
    const scripts = inlineScripts(html);
    assert.equal(scripts.length, 2, path + ': unexpected number of scripts');
    assert.equal(scripts[0], original[0], path + ': booking engine must not change');
  }
});

test('the CSP hashes match actual inline CSS and JavaScript', () => {
  for (const { path, html } of sources) {
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];
    assert.ok(csp, path + ': missing CSP');
    assert.ok(csp.includes("connect-src 'none'"), path + ': network must stay blocked');
    assert.ok(csp.includes("form-action 'none'"), path + ': external forms must stay blocked');
    for (const script of inlineScripts(html)) {
      assert.ok(csp.includes("'sha256-" + hash(script) + "'"), path + ': script digest not updated');
    }
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(css && csp.includes("'sha256-" + hash(css) + "'"), path + ': style digest not updated');
    assert.doesNotMatch(html, /\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b/);
  }
});

test('15-minute drop slot equals independent geometry for phone and wide screens', () => {
  let count = 0;
  for (const { path, html } of sources) {
    for (const width of [320, 375, 390, 414, 430, 550, 551, 768, 1024]) {
      for (const scroll of [0, 73, 205, 500, 900]) {
        const { q, label, clip, cellLeft, drop } = makeHitTest(html, width, scroll);
        for (let x = clip.left; x < clip.right; x += 3.7) {
          for (const y of [331, 332, 400, 437, 438]) {
            const slot = Math.floor((x - cellLeft) / q);
            const exposedLeft = Math.max(clip.left, cellLeft, clip.left + label);
            const inBounds = y >= 332 && y < 438 &&
              x >= exposedLeft && x < Math.min(clip.right, cellLeft + 36 * q) &&
              slot >= 0 && slot < 36;
            const expected = inBounds ? 540 + slot * 15 : null;
            const actual = drop(x, y);
            assert.equal(actual?.time ?? null, expected, path + ': width=' + width + ' scroll=' + scroll + ' x=' + x);
            if (actual) assert.equal(actual.staffId, 's1');
            count++;
          }
        }
      }
    }
  }
  assert.ok(count > 20000);
  console.log('Checked ' + count + ' simulated points across both variants.');
});

test('v0.36 stable and later previews all retain the orientation-aware fix', () => {
  for (const { path, html } of sources) {
    assert.match(html, /lastRenderedScheduleQ/, path + ': missing orientation logic');
    assert.match(html, /window\.addEventListener\('resize'/, path + ': missing resize handler');
    assert.match(html, /const q=r\.width\/36/, path + ': missing actual cell-width calculation');
  }
});
