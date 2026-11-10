#!/usr/bin/env node
// Runs every check against paste-masker.html. No dependencies: `node tests/run.js` (add -v to print outputs).
// Exit code 1 on any failure, including a known gap (todo) that now passes and should lose its todo.
'use strict';
const { loadPage } = require('./page.js');
const cases = require('./cases.js');

const verbose = process.argv.includes('-v');
let failed = 0, passed = 0;
const gaps = [];
const fail = (name, why, out) => { failed++; console.log(`FAIL  ${name}\n      ${why}` + (out !== undefined ? `\n      out: ${out}` : '')); };
const ok = (name, out) => { passed++; if (verbose) console.log(`ok    ${name}` + (out !== undefined ? `\n      ${out}` : '')); };

// ---- 1. Masking cases ----
const page = loadPage({ domains: ['example.local', 'corp.example.local'] });
for (const c of cases){
  const out = page.mask(c.in);
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
  const masked = p.mask('user jdoe@example.com on fs01.example.local from 10.0.0.5 with password=Hunter2!x');
  const t = name => (masked.match(new RegExp('\\[' + name + '_\\d+\\]')) || [])[0];
  const email = t('EMAIL'), host = t('HOST'), ip = t('PRIVATE_IP'), secret = t('SECRET');
  const checks = [
    { name: 'restore: bracketed tokens', reply: `${email} logged on to ${host} from ${ip}.`, want: ['jdoe@example.com', 'fs01.example.local', '10.0.0.5'] },
    { name: 'restore: bare tokens', reply: `${email.slice(1, -1)} used ${host.slice(1, -1)}`, want: ['jdoe@example.com', 'fs01.example.local'] },
    { name: 'restore: inside backticks and bold', reply: `\`${host}\` and **${ip}**`, want: ['`fs01.example.local`', '**10.0.0.5**'] },
    { name: 'restore: one-way token stays a token', reply: `The secret ${secret} was exposed.`, want: [secret], not: ['Hunter2!x'] },
    { name: 'restore: unknown token left alone', reply: 'See [USER_999] and [HOST_42].', want: ['[USER_999]', '[HOST_42]'] },
    // Known gaps (planned: tolerant restore)
    { name: 'restore: lowercase token', reply: host.toLowerCase(), want: ['fs01.example.local'], todo: 'planned: tolerant restore' },
    { name: 'restore: markdown-escaped token', reply: host.replace('[', '\\[').replace('_', '\\_').replace(']', '\\]'), want: ['fs01.example.local'], todo: 'planned: tolerant restore' },
    { name: 'restore: space instead of underscore', reply: host.replace('_', ' '), want: ['fs01.example.local'], todo: 'planned: tolerant restore' },
  ];
  for (const c of checks){
    const out = p.restore(c.reply);
    const problems = [...c.want.filter(v => !out.includes(v)).map(v => `missing: ${v}`), ...(c.not || []).filter(v => out.includes(v)).map(v => `must not appear: ${v}`)];
    if (c.todo){ if (problems.length) gaps.push(`${c.name} (${c.todo})`); else fail(c.name, `marked todo but now passes: remove the todo`, out); }
    else if (problems.length) fail(c.name, problems.join('; '), out);
    else ok(c.name, out);
  }
}

// ---- 3. Built-in sample round trip ----
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

// ---- 4. Performance (worst-case inputs that once froze the page) ----
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
