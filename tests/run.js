#!/usr/bin/env node
// Runs every check against paste-masker.html. No dependencies: `node tests/run.js` (add -v to print outputs).
// Exit code 1 on any failure, including a known gap (todo) that now passes and should lose its todo.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadPage } = require('./page.js');
const cases = require('./cases.js');

const verbose = process.argv.includes('-v');
let failed = 0, passed = 0;
const gaps = [];
const fail = (name, why, out) => { failed++; console.log(`FAIL  ${name}\n      ${why}` + (out !== undefined ? `\n      out: ${out}` : '')); };
const ok = (name, out) => { passed++; if (verbose) console.log(`ok    ${name}` + (out !== undefined ? `\n      ${out}` : '')); };

// ---- 1. Masking cases (a fresh page per case, so what one case learns can't change another) ----
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
    { name: 'bracketed tokens', reply: `${host} from ${ip}.`, want: [H, IP], stats: 'Restored 2 values.' },
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
    { name: 'one-way tokens stay tokens', reply: `[${secret.slice(1, -1).toLowerCase()}] and ${card} and \\[${card.slice(1, -1).replace('_', '\\_').replace(/\*/g, '\\*')}\\]`, want: [`${secret} and ${card} and ${card}`], not: ['Hunter2!x', '4111'], stats: 'One-way, kept as tokens' },
    { name: 'unknown tokens reported', reply: 'See [USER_999] and [FOO_1].', want: ['[USER_999]', '[FOO_1]'], stats: 'Not restored, not from this session: [USER_999], [FOO_1].' },
  ];
  for (const c of checks){
    const out = p.restore(c.reply);
    const stats = p.restoreStats();
    const problems = [...c.want.filter(v => !out.includes(v)).map(v => `missing: ${v}`), ...(c.not || []).filter(v => out.includes(v)).map(v => `must not appear: ${v}`)];
    if (c.stats && !stats.includes(c.stats)) problems.push(`report should include "${c.stats}", got "${stats}"`);
    problems.length ? fail('restore: ' + c.name, problems.join('; '), out) : ok('restore: ' + c.name, out);
  }
  p.clear();
  const out = p.restore(host);
  out === host && /mapping is empty/.test(p.restoreStats()) ? ok('restore: after Clear mapping') : fail('restore: after Clear mapping', `got "${out}" / "${p.restoreStats()}"`);
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
  if (p.mask('portal.contoso.com').includes('[')) problems.push('Clear mapping did not forget the learned domain');
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

// ---- 5. Field and page hardening ----
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'paste-masker.html'), 'utf8');
  const REQUIRED = ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"', 'translate="no"',
    'writingsuggestions="false"', 'data-gramm="false"', 'data-gramm_editor="false"', 'data-enable-grammarly="false"', 'data-lt-active="false"', 'data-ms-editor="false"'];
  const fields = html.match(/<(?:textarea|input)\b[^>]*>/g) || [];
  const textFields = fields.filter(f => /^<textarea/.test(f) || /type="(?:text|search|password)"/.test(f) || !/type=/.test(f));
  const missing = textFields.flatMap(f => REQUIRED.filter(a => !f.includes(a)).map(a => `${(f.match(/id="([^"]+)"/) || [])[1]} lacks ${a}`));
  missing.length || !textFields.length ? fail('every text field is hardened', missing.join('; ') || 'no text fields found') : ok('every text field is hardened', `${textFields.length} fields`);
  const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  const needs = ["default-src 'none'", "form-action 'none'", "base-uri 'none'"].filter(d => !csp.includes(d));
  needs.length ? fail('CSP', `missing ${needs.join(', ')}`) : ok('CSP', csp);
  const banned = html.match(/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<a\s|href=|<form/g);
  banned ? fail('no storage, network, HTML injection or links in the page', [...new Set(banned)].join(', ')) : ok('no storage, network, HTML injection or links in the page');
  const p = loadPage();
  const masked = p.mask('Account Name: jdoe on 10.0.0.5');
  p.restore(masked); p.pagehide();
  const left = ['input', 'output', 'reply', 'restored'].filter(id => p.field(id));
  const stillRestores = p.restore(masked).includes('jdoe');
  left.length || !stillRestores ? fail('pagehide clears the text but keeps the session', `not cleared: ${left.join(', ')}; restore after: ${stillRestores}`) : ok('pagehide clears the text but keeps the session');
}

// ---- 6. Performance (worst-case inputs that once froze the page) ----
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
