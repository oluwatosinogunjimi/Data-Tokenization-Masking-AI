#!/usr/bin/env node
// End-to-end check of the page in headless Chromium: `node tests/ui.js` (needs the playwright package).
// Without playwright it prints "skipped" and exits 0, so the dependency-free tests stay dependency-free.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPage, HTML_PATH } = require('./page.js');
const cases = require('./cases.js');

let playwright;
try { playwright = require('playwright'); } catch (e) { console.log('skipped: playwright not available'); process.exit(0); }

const URL = pathToFileURL(HTML_PATH).href;
let failed = 0, passed = 0;
const check = (name, cond, detail) => {
  if (cond){ passed++; if (process.argv.includes('-v')) console.log(`ok    ${name}` + (detail ? `  (${detail})` : '')); }
  else { failed++; console.log(`FAIL  ${name}` + (detail ? `\n      ${detail}` : '')); }
};

// The same engine in Node, to compare the page's output and clipboard with.
function nodeSample(){ const p = loadPage(); return { p, masked: p.sample().output }; }

async function main(){
  const chrome = '/usr/bin/google-chrome';
  const browser = await playwright.chromium.launch(fs.existsSync(chrome) ? { executablePath: chrome, args: ['--no-sandbox'] } : {});
  const problems = [];   // console errors, page errors and network requests, from every page
  async function open(opts = {}){
    const context = await browser.newContext(Object.assign({ viewport: { width: 1360, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 }, opts));
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', e => problems.push('page error: ' + e.message));
    page.on('request', r => { if (!/^(file|data):/.test(r.url())) problems.push('network: ' + r.url()); });
    await page.goto(URL);
    return { context, page };
  }
  const clip = page => page.evaluate(() => navigator.clipboard.readText());
  const toastText = page => page.textContent('#toast');
  const resetClip = page => page.evaluate(() => navigator.clipboard.writeText('-'));

  try {
    // ---------- Mask, highlight, copy ----------
    let { context, page } = await open();
    check('empty states explain what will appear', /Masked text appears here/.test(await page.textContent('#masked')) && /No tokens yet/.test(await page.textContent('#mapBody')));
    await page.click('#sampleBtn');
    const { p: ref, masked: refMasked } = nodeSample();
    const tokens = await page.locator('#masked .tk').count();
    check('sample masks with highlighted tokens', tokens > 10, `${tokens} tokens`);
    check('rendered text equals the engine output', (await page.textContent('#masked')) === refMasked);
    check('mask tab badge counts tokens', /\d+ tokens/.test(await page.textContent('#maskMeta')));
    check('legend lists categories with counts', (await page.locator('#legend button').count()) >= 5);
    check('status line lists what was masked', /^Masked: /.test(await page.textContent('#maskStatus')));

    await page.click('#copyMaskedBtn');
    check('Copy masked copies exactly the engine output', (await clip(page)) === refMasked);
    check('toast confirms the copy', (await toastText(page)) === 'Copied masked text');

    // A hand-made selection copies as plain text equal to that slice of the engine output.
    await resetClip(page);
    const sel = await page.evaluate(() => {
      const box = document.getElementById('masked'), toks = box.querySelectorAll('.tk');
      const r = document.createRange();
      r.setStart(toks[1].firstChild, 3); r.setEnd(toks[6].firstChild, 2);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      box.focus({ preventScroll: true });
      const pre = document.createRange(); pre.setStart(box, 0); pre.setEnd(toks[1].firstChild, 3);
      const len = document.createRange(); len.setStart(box, 0); len.setEnd(toks[6].firstChild, 2);
      return [pre.toString().length, len.toString().length];
    });
    await page.keyboard.press('Control+C');
    check('selecting part of the output copies the same slice of the engine output', (await clip(page)) === refMasked.slice(sel[0], sel[1]));
    await page.evaluate(() => getSelection().removeAllRanges());

    // ---------- Token popover, click, shift-click ----------
    const host = await page.evaluate(() => PM.rows().find(r => r.label === 'HOST' && r.value.includes('.')));
    const hostTok = page.locator('#masked .tk', { hasText: host.token }).first();
    await hostTok.hover();
    const pvText = await page.textContent('#pv');
    check('hover shows the token, its type and the real value', !(await page.isHidden('#pv')) && pvText.includes(host.token) && pvText.includes(host.value) && pvText.includes('Host and cloud'));
    const occurrences = (refMasked.match(new RegExp(host.token.replace(/[[\]]/g, '\\$&'), 'g')) || []).length;
    check('hover outlines every occurrence of the token', (await page.locator('#masked .same').count()) === occurrences, `${occurrences} occurrences`);
    await hostTok.click();
    check('click copies the real value', (await clip(page)) === host.value);
    const t1 = await toastText(page);
    check('the toast names the token, never the value', t1 === 'Copied real value of ' + host.token && !t1.includes(host.value), t1);
    await hostTok.click({ modifiers: ['Shift'] });
    check('shift-click copies the token', (await clip(page)) === host.token);
    const card = page.locator('#masked .tk.c-ow', { hasText: '[CARD_' }).first();
    const cardText = await card.textContent();
    await card.hover();
    check('one-way popover says the value was never kept', /never kept/.test(await page.textContent('#pv')));
    await card.click();
    check('click on a one-way token copies the token', (await clip(page)) === cardText);

    // Keyboard: arrows move between tokens, Enter copies.
    await page.mouse.move(5, 500);
    await page.focus('#masked');
    await page.keyboard.press('ArrowRight');
    const first = await page.evaluate(() => document.activeElement.textContent);
    check('arrow keys move focus onto tokens and show the popover', /^\[[A-Z_0-9]+(?::\*{4}\d{4})?\]$/.test(first) && !(await page.isHidden('#pv')), first);
    await page.keyboard.press('Shift+Enter');
    check('Shift+Enter copies the focused token', (await clip(page)) === first);
    await page.keyboard.press('Escape');
    check('Esc closes the popover', await page.isHidden('#pv'));

    // Legend hover outlines a whole category.
    await page.hover('#legend button[data-cat="net"]');
    check('legend hover outlines that type', (await page.getAttribute('#masked', 'data-lit')) === 'net');
    await page.mouse.move(5, 500);

    // ---------- Hide values ----------
    await page.click('#hideBtn');
    const mapText = await page.textContent('#mapBody');
    check('Hide values removes real values from the mapping', !mapText.includes(host.value) && (await page.locator('#mapBody .redact').count()) > 0);
    await hostTok.hover();
    check('Hide values removes the real value from the popover', !(await page.textContent('#pv')).includes(host.value) && (await page.locator('#pv .redact').count()) === 1);
    await hostTok.click();
    check('copying still works while values are hidden', (await clip(page)) === host.value);
    await page.mouse.move(5, 500);
    await page.click('#hideBtn');
    check('values come back when Hide values is off', (await page.textContent('#mapBody')).includes(host.value));

    // ---------- Mapping table and filter ----------
    const rowCount = await page.locator('#mapBody tr').count();
    check('mapping lists every token', rowCount === ref.PM.size(), `${rowCount} rows`);
    check('one-way rows have no value and no copy', (await page.locator('#mapBody td.val.none', { hasText: 'Not kept (one-way)' }).count()) > 0 && (await page.locator('#mapBody button.icon-btn[disabled]').count()) > 0);
    await page.locator('#mapBody tr', { hasText: host.token }).first().locator('button.icon-btn').click();
    check('mapping copy button copies the real value', (await clip(page)) === host.value);
    await page.mouse.click(5, 500);
    await page.keyboard.press('/');
    check('/ focuses the filter', await page.evaluate(() => document.activeElement.id === 'filter'));
    await page.keyboard.type('public_ip');
    const filtered = await page.locator('#mapBody tr').allTextContents();
    check('filter narrows the mapping', filtered.length >= 1 && filtered.length < rowCount && filtered.every(t => t.includes('PUBLIC_IP')), `${filtered.length} rows`);
    await page.fill('#filter', '');

    // ---------- Settings drawer ----------
    await page.mouse.click(5, 500);
    await page.focus('#maskBtn');
    await page.keyboard.press('s');
    check('S opens the settings drawer as a modal dialog', await page.evaluate(() => document.getElementById('settings').open && document.getElementById('settings').matches(':modal')));
    await page.keyboard.press('Escape');
    check('Esc closes settings and focus returns', await page.evaluate(() => !document.getElementById('settings').open && document.activeElement.id === 'maskBtn'));
    await page.click('#settingsSummary');
    await page.uncheck('[data-g="ips"]');
    await page.click('#closeSettings');
    check('settings summary updates', /^11 detectors on/.test(await page.textContent('#settingsSummary')), await page.textContent('#settingsSummary'));
    await page.click('#maskBtn');
    const noIps = await page.textContent('#masked');
    check('a settings toggle changes the next Mask', noIps.includes('10.20.30.40') && !noIps.includes('[PRIVATE_IP_'));
    await page.click('#settingsBtn');
    await page.check('[data-g="ips"]');
    await page.keyboard.press('Escape');
    await page.click('#maskBtn');

    // ---------- Shortcuts panel and tabs ----------
    await page.mouse.click(5, 500);
    await page.keyboard.press('?');
    check('? opens the shortcuts panel', await page.evaluate(() => document.getElementById('keys').open));
    await page.keyboard.press('Escape');
    check('Esc closes the shortcuts panel', await page.evaluate(() => !document.getElementById('keys').open));
    await page.keyboard.press('r');
    check('R switches to the Restore tab', (await page.getAttribute('#tab-restore', 'aria-selected')) === 'true' && await page.isVisible('#panel-restore') && await page.isHidden('#panel-mask'));
    check('restored empty state explains what will appear', /Restored text appears here/.test(await page.textContent('#restored')));

    // ---------- Restore ----------
    const shown = await page.textContent('#masked');
    const user = await page.evaluate(() => PM.rows().find(r => r.label === 'USER').token);
    const reply = 'Summary:\n' + shown.split(host.token).join('[' + host.token.slice(1, -1).toLowerCase().replace(/_/g, ' ') + ']')
      .split(user).join('\\' + user.slice(0, -1).replace('_', '\\_') + '\\]') + '\nAlso [USER_999].';
    await page.fill('#reply', reply);
    await page.keyboard.press('Control+Enter');
    ref.restore(reply);
    const refRestored = ref.lastRestore().text;
    check('restored text equals the engine output', (await page.textContent('#restored')) === refRestored);
    check('reformatted tokens are restored', refRestored.includes(host.value) && !refRestored.includes('[host'));
    check('restored values are marked', (await page.locator('#restored .rv').count()) > 5);
    const report = await page.textContent('#restoreReport');
    check('the restore report lists unknown and one-way tokens', /Restored \d+ values\./.test(report) && report.includes('Not restored, not from this session: [USER_999].') && report.includes('One-way, kept as tokens:'), report);
    check('restore tab badge counts restored values', /\d+ restored/.test(await page.textContent('#restoreMeta')));
    await page.locator('#restored .rv', { hasText: host.value }).first().hover();
    check('hovering a restored value shows its token', (await page.textContent('#pv')).includes('from ' + host.token));
    await page.mouse.move(5, 500);
    await page.click('#copyRestoredBtn');
    check('Copy restored copies exactly the engine output', (await clip(page)) === refRestored);
    check('restored copy toast has no values', (await toastText(page)) === 'Copied restored text');
    await page.keyboard.press('m');
    check('M switches back to Mask', (await page.getAttribute('#tab-mask', 'aria-selected')) === 'true');

    // ---------- pagehide clears text but keeps the session ----------
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    const afterHide = await page.evaluate(() => ({ input: document.getElementById('input').value, reply: document.getElementById('reply').value,
      masked: document.querySelectorAll('#masked .tk').length, restored: document.querySelectorAll('#restored .rv').length, size: PM.size() }));
    check('pagehide clears the text boxes and outputs, not the mapping', !afterHide.input && !afterHide.reply && !afterHide.masked && !afterHide.restored && afterHide.size > 0, JSON.stringify(afterHide));

    // ---------- End session ----------
    await page.click('#sampleBtn');
    await page.click('#endBtn');
    check('End session asks first, in the page', await page.evaluate(() => document.getElementById('confirmEnd').open));
    await page.click('#confirmCancel');
    check('Cancel keeps the mapping', (await page.evaluate(() => PM.size())) > 0);
    await page.click('#endBtn');
    await page.click('#confirmOk');
    // With no internal domains configured, contoso.com could only be masked if it were still learned.
    const ended = await page.evaluate(() => ({ size: PM.size(), input: document.getElementById('input').value, tokens: document.querySelectorAll('#masked .tk').length,
      learned: (PM.configure({}), PM.mask('portal.contoso.com').text) }));
    check('End session clears the mapping, learned domains and text', ended.size === 0 && !ended.input && !ended.tokens && ended.learned === 'portal.contoso.com', JSON.stringify(ended));

    // ---------- Theme ----------
    const before = await page.evaluate(() => document.documentElement.dataset.theme || null);
    await page.click('#themeBtn');
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    check('theme toggle switches to Night', before === null && after === 'dark');
    await page.reload();
    const stored = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, keys: Object.keys(localStorage), value: localStorage.getItem('paste-masker-theme'),
      session: sessionStorage.length, cookie: document.cookie, input: document.getElementById('input').value }));
    check('theme choice persists across reload', stored.theme === 'dark');
    check('storage holds only the theme key, as "light" or "dark"', JSON.stringify(stored.keys) === '["paste-masker-theme"]' && stored.value === 'dark' && stored.session === 0 && stored.cookie === '', JSON.stringify(stored));
    check('nothing typed survives a reload', stored.input === '');
    const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).length : 0));
    check('no IndexedDB databases', dbs === 0);
    await page.click('#themeBtn');
    check('theme toggle switches back to Day', (await page.evaluate(() => localStorage.getItem('paste-masker-theme'))) === 'light');
    await context.close();

    // ---------- Phone width ----------
    ({ context, page } = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }));
    await page.click('#sampleBtn');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check('no horizontal scroll at 390px (Mask)', !(await overflow()));
    await page.locator('#masked .tk').nth(2).tap();
    check('tap pins the popover with copy buttons', await page.evaluate(() => document.getElementById('pv').classList.contains('pinned')) && (await page.locator('#pv button').count()) >= 1);
    await page.click('#tab-restore');
    check('no horizontal scroll at 390px (Restore)', !(await overflow()));
    await page.click('#settingsBtn');
    check('settings drawer fits a phone', await page.evaluate(() => document.getElementById('settings').getBoundingClientRect().width <= innerWidth) && !(await overflow()));
    await context.close();

    // ---------- Performance: about 1.5 MB, once of mixed logs and once of tens of thousands of distinct values ----------
    ({ context, page } = await open());
    const unit = cases.map(c => c.in).join('\n') + '\n';
    let distinct = '';
    for (let i = 0; distinct.length < 1.5e6; i++) distinct += `2026-11-10T09:00:00Z sign-in user=u${i}x from 10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255} host=WS-${i} mail a${i}@example.com\n`;
    for (const [name, big] of [['mixed logs', unit.repeat(Math.ceil(1.5e6 / unit.length)).slice(0, 1.5e6)], ['distinct values', distinct.slice(0, 1.5e6)]]){
      await page.evaluate(t => { PM.clear(); document.getElementById('input').value = t; }, big);
      const perf = await page.evaluate(() => new Promise(res => {
        const t0 = performance.now();
        document.getElementById('maskBtn').click();
        const t1 = performance.now();
        void document.getElementById('masked').scrollHeight;   // force layout
        requestAnimationFrame(() => requestAnimationFrame(() => res({ mask: Math.round(t1 - t0), painted: Math.round(performance.now() - t0),
          shown: document.querySelectorAll('#masked .tk').length, rows: PM.size() })));
      }));
      const detail = `${(big.length / 1e6).toFixed(1)} MB of ${name}: ${perf.mask} ms mask and render, ${perf.painted} ms until painted, ${perf.shown} tokens highlighted, ${perf.rows} in the mapping`;
      check(`1.5 MB of ${name} masks and renders in under 5 s`, perf.painted < 5000, detail);
      check(`a huge mapping shows at most 500 rows (${name})`, (await page.locator('#mapBody tr').count()) <= 500);
      const t0 = Date.now();
      await page.fill('#filter', 'host_1');
      check(`filtering the mapping stays quick (${name})`, Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
      await page.fill('#filter', '');
      console.log('perf: ' + detail);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  check('no console errors, page errors or network requests', !problems.length, problems.join('; '));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch(e => { console.log('FAIL  ' + (e && e.stack || e)); process.exitCode = 1; });
