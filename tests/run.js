#!/usr/bin/env node
// Runs every check against paste-masker.html's engine, plus static checks on the whole page.
// No dependencies: `node tests/run.js` (add -v to print outputs). tests/ui.js covers the interface in a browser.
// Exit code 1 on any failure, including a known gap (todo) that now passes and should lose its todo.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPage, scriptBlock, HTML_PATH } = require('./page.js');
const cases = require('./cases.js');

const verbose = process.argv.includes('-v');
let failed = 0, passed = 0;
const gaps = [];
const fail = (name, why, out) => { failed++; console.log(`FAIL  ${name}\n      ${why}` + (out !== undefined ? `\n      out: ${out}` : '')); };
const ok = (name, out) => { passed++; if (verbose) console.log(`ok    ${name}` + (out !== undefined ? `\n      ${out}` : '')); };

// ---- 1. Masking cases (a fresh engine per case, so what one case learns can't change another) ----
for (const c of cases){
  const out = loadPage(Object.assign({ domains: ['example.local', 'corp.example.local'] }, c.opts)).mask(c.in);
  const problems = [
    ...c.leak.filter(v => out.includes(v)).map(v => `leaked: ${v}`),
    ...c.keep.filter(v => !out.includes(v)).map(v => `lost: ${v}`),
  ];
  if (c.same){
    const toks = new Set(out.match(new RegExp('\\[' + c.same + '\\d+\\]', 'g')) || []);
    if (toks.size !== 1) problems.push(`expected one ${c.same}n token, got ${[...toks].join(', ') || 'none'}`);
  }
  if (c.todo){
    if (problems.length) gaps.push(`${c.name} (${c.todo})`);
    else fail(c.name, `marked todo (${c.todo}) but now passes: remove the todo`, out);
  } else if (problems.length) fail(c.name, problems.join('; '), out);
  else ok(c.name, out);
}

// ---- 2. Restore ----
{
  const p = loadPage({ domains: ['example.local'] });
  const masked = p.mask('C:\\Users\\jdoe\\x on fs01.example.local from 10.0.0.5 password=Hunter2!x card 4111 1111 1111 1111');
  const t = name => (masked.match(new RegExp('\\[' + name + '_\\d+(?::[^\\]]*)?\\]')) || [])[0];
  const user = t('USER'), host = t('HOST'), ip = t('PRIVATE_IP'), secret = t('SECRET'), card = t('CARD');
  const H = 'fs01.example.local', IP = '10.0.0.5';
  const hn = host.slice(1, -1), ipn = ip.slice(1, -1);   // HOST_1, PRIVATE_IP_1
  const checks = [
    { name: 'bracketed tokens', reply: `${host} from ${ip}.`, want: [H, IP], restored: 2, stats: 'Restored 2 values.' },
    { name: 'bare tokens', reply: `${hn} from ${ipn}`, want: [H, IP] },
    { name: 'inside backticks and bold', reply: `\`${host}\` and **${ip}**`, want: ['`' + H + '`', '**' + IP + '**'] },
    { name: 'lowercase and title case', reply: `[${hn.toLowerCase()}] and [${hn[0] + hn.slice(1).toLowerCase()}]`, want: [`${H} and ${H}`] },
    { name: 'markdown-escaped', reply: `\\[${hn.replace('_', '\\_')}\\] and [${ipn.replace(/_/g, '\\_')}]`, want: [`${H} and ${IP}`] },
    { name: 'space, hyphen or padding instead of underscore', reply: `[${hn.replace('_', ' ')}] [${hn.replace('_', '-')}] [ ${hn} ] [private ip ${ipn.split('_').pop()}]`, want: [`${H} ${H} ${H} ${IP}`] },
    { name: 'one bracket missing', reply: `[${hn} was down; ${hn}] too`, want: [`${H} was down; ${H} too`] },
    { name: 'plurals', reply: `${hn}s and ${hn}'s disk`, want: [`${H}s and ${H}'s disk`] },
    { name: 'invisible characters inside', reply: `[${hn.replace('_', '\u200B_')}] and [${hn.replace('_', '\u00a0')}]`, want: [`${H} and ${H}`] },
    { name: 'token inside a Windows path', reply: `C:\\Users\\${user}\\AppData`, want: ['C:\\Users\\jdoe\\AppData'] },
    { name: 'prose and code left alone', reply: `user 1 of 3, host 1, ${hn.toLowerCase()} = 5, ${hn}0`, want: [`user 1 of 3, host 1, ${hn.toLowerCase()} = 5, ${hn}0`] },
    { name: 'one-way tokens stay tokens', reply: `[${secret.slice(1, -1).toLowerCase()}] and ${card} and \\[${card.slice(1, -1).replace('_', '\\_').replace(/\*/g, '\\*')}\\]`, want: [`${secret} and ${card} and ${card}`], not: ['Hunter2!x', '4111'], oneWay: [secret, card.replace(/:.*\]$/, ']')], stats: 'One-way, kept as tokens' },
    { name: 'unknown tokens reported', reply: 'See [USER_999] and [FOO_1].', want: ['[USER_999]', '[FOO_1]'], unknown: ['[USER_999]', '[FOO_1]'], stats: 'Not restored, not from this session: [USER_999], [FOO_1].' },
  ];
  for (const c of checks){
    const out = p.restore(c.reply);
    const r = p.lastRestore();
    // The report the page shows is built by PM.report from these lists.
    const stats = p.PM.report(r).map(l => l.text).join(' ');
    const problems = [...c.want.filter(v => !out.includes(v)).map(v => `missing: ${v}`), ...(c.not || []).filter(v => out.includes(v)).map(v => `must not appear: ${v}`)];
    if (c.restored !== undefined && r.restored !== c.restored) problems.push(`restored ${r.restored}, expected ${c.restored}`);
    for (const k of ['unknown', 'oneWay']) if (c[k] && JSON.stringify(r[k]) !== JSON.stringify(c[k])) problems.push(`${k} is ${JSON.stringify(r[k])}, expected ${JSON.stringify(c[k])}`);
    if (c.stats && !stats.includes(c.stats)) problems.push(`report should include "${c.stats}", got "${stats}"`);
    problems.length ? fail('restore: ' + c.name, problems.join('; '), out) : ok('restore: ' + c.name, out);
  }
  p.clear();
  const out = p.restore(host);
  const r = p.lastRestore(), rep = p.PM.report(r).map(l => l.text).join(' ');
  out === host && r.mappingEmpty && r.unknown.length === 1 && /mapping is empty/.test(rep) ? ok('restore: after End session') : fail('restore: after End session', `got "${out}" / "${rep}"`);
}

// ---- 3. Session: a second paste reuses tokens and learned domains ----
{
  const p = loadPage();
  const first = p.mask('Account Name: aokonkwo from jdoe@contoso.com on WS-0042');
  const second = p.mask('aokonkwo opened https://portal.contoso.com today');
  const tok = (first.match(/\[USER_\d+\]/) || [])[0];
  const problems = [];
  if (!tok || !second.includes(tok)) problems.push(`user token not reused: ${tok}`);
  if (second.includes('contoso')) problems.push('learned domain not applied to the second paste');
  p.clear();
  if (p.mask('portal.contoso.com').includes('[')) problems.push('End session did not forget the learned domain');
  problems.length ? fail('session reuse', problems.join('; '), second) : ok('session reuse', second);
}

// ---- 4. Built-in sample round trip ----
{
  const p = loadPage();
  const { input, output } = p.sample();
  const restored = p.restore('Summary:\n' + output);
  const oneWay = ['Winter2026!', 'Summer2026!', 'Hunt3r2', 'ghp_', '4111 1111', '22212345678', 'eyJ', 'Ab%2B'];
  const twoWay = ['jane.doe@contoso.com', 'DESKTOP-7FQ2K9L', 'jdoe', '10.20.30.40', '198.51.100[.]7', '0123456789', 'fs01.corp.contoso.com', 'contosobackup'];
  const leaked = oneWay.filter(v => output.includes(v));
  const lost = twoWay.filter(v => !restored.includes(v));
  const back = oneWay.filter(v => restored.includes(v));
  if (!input || leaked.length || lost.length || back.length) fail('sample round trip', `leaked: ${leaked} | not restored: ${lost} | one-way came back: ${back}`, output);
  else ok('sample round trip');
}

// ---- 5. Spans: where mask() and restore() say each token is, for highlighting ----
{
  const p = loadPage();
  const { output } = p.sample();
  const m = p.PM.mask(p.PM.sample.text);
  const problems = [];
  let prev = 0;
  for (const sp of m.spans){
    const shown = m.text.slice(sp.start, sp.end);
    if (sp.start < prev) problems.push(`overlapping or unordered span at ${sp.start}`);
    if (!/^\[[A-Z][A-Z0-9_]*_\d+(?::\*{4}\d{4})?\]$/.test(shown) || !shown.startsWith(sp.token.slice(0, -1))) problems.push(`span ${sp.start}-${sp.end} shows "${shown}" for ${sp.token}`);
    if (!p.PM.lookup(sp.token)) problems.push(`span token ${sp.token} is not in the mapping`);
    prev = sp.end;
  }
  const inText = (m.text.match(/\[[A-Z][A-Z0-9_]*_\d+(?::\*{4}\d{4})?\]/g) || []).length;
  if (m.spans.length !== inText) problems.push(`${m.spans.length} spans for ${inText} tokens in the text`);
  if (m.text !== output) problems.push('masking the same text twice gave different output');
  problems.length ? fail('mask spans match the text', problems.join('; ')) : ok('mask spans match the text', `${m.spans.length} spans`);

  const r = p.PM.restore('Hosts: ' + m.text + '\n[FOO_1] and [HOST_99]');
  const bad = r.spans.filter(sp => {
    const shown = r.text.slice(sp.start, sp.end), row = p.PM.lookup(sp.token);
    if (sp.kind === 'restored') return !row || shown !== row.value;
    if (sp.kind === 'oneway') return !row || !row.oneWay || !shown.startsWith(sp.token.slice(0, -1));
    return shown !== sp.token;
  });
  const kinds = new Set(r.spans.map(sp => sp.kind));
  bad.length || kinds.size !== 3 ? fail('restore spans match the text', `${bad.length} wrong spans; kinds: ${[...kinds]}`) : ok('restore spans match the text', `${r.spans.length} spans`);

  const rows = p.PM.rows();
  const user = rows.find(x => x.label === 'USER' && x.value === 'jdoe');
  rows.every(x => x.oneWay === (x.value === null)) && user && user.seen >= 3
    ? ok('mapping rows carry type, value and times seen') : fail('mapping rows carry type, value and times seen', JSON.stringify(user));
}

// ---- 6. Field and page hardening (static checks on the whole file) ----
{
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const engine = scriptBlock('engine'), ui = scriptBlock('ui');
  const REQUIRED = ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"', 'translate="no"',
    'writingsuggestions="false"', 'data-gramm="false"', 'data-gramm_editor="false"', 'data-enable-grammarly="false"', 'data-lt-active="false"', 'data-ms-editor="false"'];
  const fields = html.match(/<(?:textarea|input)\b[^>]*>/g) || [];
  const textFields = fields.filter(f => /^<textarea/.test(f) || /type="(?:text|search|password)"/.test(f) || !/type=/.test(f));
  const missing = textFields.flatMap(f => REQUIRED.filter(a => !f.includes(a)).map(a => `${(f.match(/id="([^"]+)"/) || [])[1]} lacks ${a}`));
  missing.length || !textFields.length ? fail('every text field is hardened', missing.join('; ') || 'no text fields found') : ok('every text field is hardened', `${textFields.length} fields`);
  /<html[^>]*\btranslate="no"/.test(html) && /<meta name="google" content="notranslate">/.test(html)
    ? ok('page opts out of translation') : fail('page opts out of translation', 'missing <html translate="no"> or the notranslate meta');
  const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const needs = ["default-src 'none'", "form-action 'none'", "base-uri 'none'"].filter(d => !csp.includes(d));
  const extra = csp.split(';').map(d => d.trim()).filter(Boolean).filter(d => !["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:', "form-action 'none'", "base-uri 'none'"].includes(d));
  needs.length || extra.length ? fail('CSP', `missing ${needs.join(', ')}; unexpected ${extra.join(', ')}`) : ok('CSP', csp);

  // Storage: the only use allowed is the theme choice, the literal "light" or "dark" under one key, inside try.
  const ALLOWED_STORAGE = [
    "localStorage.getItem('paste-masker-theme')",
    "localStorage.setItem('paste-masker-theme', t === 'dark' ? 'dark' : 'light')",
  ];
  const storageProblems = [];
  html.split('\n').forEach((line, i) => {
    if (!/localStorage/.test(line)) return;
    let rest = line;
    for (const a of ALLOWED_STORAGE) rest = rest.split(a).join('');
    if (/localStorage/.test(rest)) storageProblems.push(`line ${i + 1}: storage use other than the theme key`);
    else if (!/\btry\s*\{/.test(line.slice(0, line.indexOf('localStorage')))) storageProblems.push(`line ${i + 1}: theme storage outside try`);
  });
  if ((html.match(/localStorage/g) || []).length !== 2) storageProblems.push('expected exactly one theme read and one theme write');
  if (/localStorage/.test(engine)) storageProblems.push('the engine touches storage');
  storageProblems.length ? fail('storage: only the theme choice', storageProblems.join('; ')) : ok('storage: only the theme choice');

  const banned = html.match(/sessionStorage|indexedDB|document\.cookie|caches\.|openDatabase|innerHTML|outerHTML|insertAdjacentHTML|document\.write|fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|<a\s|href=|<form|<iframe|<object|<embed/g);
  banned ? fail('no other storage, network, HTML injection or links in the page', [...new Set(banned)].join(', ')) : ok('no other storage, network, HTML injection or links in the page');
  const dom = engine.match(/\b(?:document|window|navigator|globalThis|self|localStorage)\s*\.|\baddEventListener\s*\(/g);
  dom ? fail('engine has no DOM access', [...new Set(dom)].join(', ')) : ok('engine has no DOM access');
  /PM\.report\(r\)\.map\(line => el\('li', line\.kind, line\.text\)\)/.test(ui)
    ? ok('restore report on the page is built by PM.report') : fail('restore report on the page is built by PM.report', 'the UI no longer renders PM.report(r)');
  // pagehide clears the working text and both rendered outputs; the mapping itself is not touched.
  const hide = (ui.match(/addEventListener\('pagehide', \(\) => \{([\s\S]*?)\n\}\);/) || [])[1] || '';
  const wants = ["$('input').value = ''", "$('reply').value = ''", 'clearMasked()', 'clearRestored()'].filter(w => !hide.includes(w));
  wants.length || /PM\.clear/.test(hide) ? fail('pagehide clears the text but keeps the session', `handler lacks ${wants.join(', ') || 'nothing'}${/PM\.clear/.test(hide) ? '; it clears the mapping' : ''}`) : ok('pagehide clears the text but keeps the session');
  /function clearMasked\(\)\{\s*view\.masked = null;/.test(ui) && /function clearRestored\(\)\{\s*view\.restored = null;/.test(ui)
    ? ok('clearing an output drops its text') : fail('clearing an output drops its text', 'clearMasked/clearRestored must reset view first');
}

// ---- 7. Performance (worst-case inputs that once froze the page) ----
{
  const p = loadPage();
  const LIMIT_MS = 2000;
  const inputs = [
    ['long dotted run before an email (200 KB)', 'x ' + 'a.'.repeat(100000) + ' real.user@example.com'],
    ['dotted digits (40 KB)', 'x ' + Array.from({ length: 20000 }, (_, k) => k % 10).join('.')],
    ['one 900 KB line of tool names', 'psexec a '.repeat(100000)],
    ['one 150 KB line of curl flags', 'curl -x '.repeat(20000)],
    ['backslash chain (200 KB)', 'C:\\' + 'Program Files\\'.repeat(14000)],
  ];
  for (const [name, text] of inputs){
    const t0 = performance.now(); p.mask(text); const ms = performance.now() - t0;
    if (ms > LIMIT_MS) fail(`perf: ${name}`, `${ms.toFixed(0)} ms (limit ${LIMIT_MS} ms)`);
    else ok(`perf: ${name}`, `${ms.toFixed(0)} ms`);
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${gaps.length} known gaps`);
if (gaps.length && (verbose || process.argv.includes('--gaps'))) console.log('\nKnown gaps:\n  ' + gaps.join('\n  '));
else if (gaps.length) console.log('(run with --gaps to list them)');
process.exitCode = failed ? 1 : 0;
