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

// ---- 4b. Entities: exact restore of every form, tolerant forms with sub-indexes, a full round trip ----
{
  const p = loadPage({ terms: ['Jane Doe | PERSON', 'Acme Ltd | ORG', 'NAS-01 | HOST'] });
  const original = [
    'Display Name: Jane Doe',
    'Ticket from Doe, Jane (JANE DOE) about J. Doe and jane doe.',
    'Jane said Doe was out; JANE confirmed.',
    'Logons: CORP\\jdoe, C:\\Users\\jane.doe\\Desktop, net user doej /add, Account Name: janed',
    'Mrs Doe and Dr Jane A. Doe signed for Acme Ltd and ACME LTD.',
    'Device=NAS-01 and nas-01 rebooted. A grace period applies; we will see.',
    'Links: https://jdoe.example.com/u/jdoe?owner=Jane%20Doe&id=jane.doe#Doe and \\\\fs01\\jdoe\\x and "/srv/Jane/x"',
  ].join('\n');
  const masked = p.mask(original);
  const back = p.restore(masked);
  const r = p.lastRestore();
  back === original && !r.unknown.length && !r.oneWay.length
    ? ok('entities: round trip restores the original exactly', masked) : fail('entities: round trip restores the original exactly', `unknown ${r.unknown}`, back);
  const tokOf = v => (p.PM.rows().find(x => x.value === v) || {}).token;
  const checks = [
    ['sub-indexed, bracketed', `${tokOf('Doe, Jane')} and ${tokOf('JANE DOE')}`, 'Doe, Jane and JANE DOE'],
    ['sub-indexed, reformatted', `[person ${tokOf('Doe, Jane').slice(8, -1)}] and \\[PERSON\\_${tokOf('JANE DOE').slice(8, -1)}\\]`, 'Doe, Jane and JANE DOE'],
    ['multi-underscore labels, every tolerant form', `[person first 1], [Person-First-1], PERSON\\_FIRST\\_1, \\[PERSON\\_LAST\\_1\\], [person_user_1]`, 'Jane, Jane, Jane, Doe, jane.doe'],   // the profile path is found first, so jane.doe is [PERSON_USER_1]
    ['bare token at a sentence end', 'Ask PERSON_USER_1. Then PERSON_LAST_1.', 'Ask jane.doe. Then Doe.'],
    ['bare sub-indexed token', `See ${tokOf('doej').slice(1, -1)} now`, 'See doej now'],
    ['[X_1.2] is not [X_1] then ".2"', `${tokOf('Jane Doe')}.2 vs ${tokOf('Doe, Jane')}`, 'Jane Doe.2 vs Doe, Jane'],
    ['other entities', `${tokOf('ACME LTD')} / [org 1] / ${tokOf('nas-01')}`, 'ACME LTD / Acme Ltd / nas-01'],
  ];
  for (const [name, reply, want] of checks){
    const out = p.restore(reply);
    out === want ? ok('entities restore: ' + name, out) : fail('entities restore: ' + name, `expected "${want}"`, out);
  }
  const u = p.restore('[PERSON_1.99] and [PERSON_FIRST_7]');
  const ur = p.lastRestore();
  u === '[PERSON_1.99] and [PERSON_FIRST_7]' && JSON.stringify(ur.unknown) === '["[PERSON_1.99]","[PERSON_FIRST_7]"]'
    ? ok('entities restore: unknown sub-indexes are reported') : fail('entities restore: unknown sub-indexes are reported', JSON.stringify(ur.unknown), u);
  // Counts per entity, for the chips, and End session keeping the list (the list is settings, not mapping).
  const m = p.PM.mask('Jane Doe and jdoe');
  const key = 'PERSON|jane doe';
  m.entities[key] === 2 ? ok('entities: match counts per entity') : fail('entities: match counts per entity', JSON.stringify(m.entities));
  p.clear();
  const again = p.PM.mask('Jane Doe');
  again.text === '[PERSON_1]' && p.PM.size() === 1 ? ok('entities: End session clears tokens, not the list') : fail('entities: End session clears tokens, not the list', again.text);
  const parsed = p.PM.parseTerms('Jane Doe | PERSON\n# note\nAcme Ltd\nx\nNAS-01 | host');
  JSON.stringify(parsed.map(x => x.key)) === '["PERSON|jane doe","TERM|acme ltd","HOST|nas-01"]'
    ? ok('entities: parseTerms reads the list as configure does') : fail('entities: parseTerms reads the list as configure does', JSON.stringify(parsed));
}

// ---- 4c. Manual grouping ----
{
  const check = (name, cond, detail) => cond ? ok('grouping: ' + name, detail) : fail('grouping: ' + name, detail || 'failed');
  const p = loadPage({ domains: ['example.local'], terms: ['Jane Doe | PERSON'] });
  const raw = 'host fs01.example.local and nas2.example.local from 10.0.0.5; user=bob2 mail bob@example.com; Jane and jdoe; password=Hunter2!x';
  const first = p.mask(raw);
  const P = p.PM, tk = v => P.rows().find(r => r.value === v && !r.alias).token;
  const [H1, H2, IP, U, E] = ['fs01.example.local', 'nas2.example.local', '10.0.0.5', 'bob2', 'bob@example.com'].map(tk);
  const SEC = P.rows().find(r => r.oneWay).token;

  let g = P.group(H2, H1);
  check('same type takes the next sub-index', g.ok && g.token === '[HOST_1.2]' && g.root === '[HOST_1]', JSON.stringify(g));
  g = P.group(IP, H2);   // the target is a member: its root is [HOST_1]
  check('cross-type gets a composite label under the target\u2019s root', g.ok && g.token === '[HOST_PRIVATE_IP_1]', JSON.stringify(g));
  g = P.group(U, '[PERSON_FIRST_1]');   // an entity part: its root is the entity, [PERSON_1]; the entity already has [PERSON_USER_1]
  check('an entity part resolves to its entity, and a taken label+number gets a sub-index', g.ok && g.token === '[PERSON_USER_1.2]', JSON.stringify(g));
  g = P.group(E, U);
  check('a token already grouped is a valid target', g.ok && g.token === '[PERSON_EMAIL_1]', JSON.stringify(g));
  const one = [P.group(SEC, H1), P.group(H1, SEC)];
  check('one-way tokens are rejected as source and as target', one.every(x => !x.ok && /One-way/.test(x.reason)), JSON.stringify(one));
  check('grouping into the same group is rejected', !P.group(H2, H1).ok && !P.group('[HOST_1.2]', H1).ok);

  const second = p.mask(raw);
  check('the next Mask uses the new tokens', ['[HOST_1.2]', '[HOST_PRIVATE_IP_1]', '[PERSON_USER_1.2]', '[PERSON_EMAIL_1]'].every(t => second.includes(t)) && ![H2, IP, U, E].some(t => second.includes(t)), second);
  const later = p.mask('later: nas2.example.local talked to 10.0.0.5, bob2 again');
  check('later pastes and re-masking of known values use them', later === 'later: [HOST_1.2] talked to [HOST_PRIVATE_IP_1], [PERSON_USER_1.2] again', later);
  check('rewrite moves already-masked text to the current tokens', P.rewrite(first).text === second, P.rewrite(first).text);
  const aliases = P.rows().filter(r => r.alias);
  check('old tokens are kept as aliases of the new ones', aliases.map(r => r.token).sort().join() === [H2, U, IP, E].sort().join() && aliases.every(r => P.lookup(r.aliasOf) && P.lookup(r.aliasOf).value === r.value));
  const reply = `Old ${H2} and ${IP}; new [host 1.2], HOST_PRIVATE_IP_1, [person_user_1.2], [Person Email 1] and \\[HOST\\_1.2\\].`;
  const back = p.restore(reply);
  check('a reply mixing old and new tokens, reformatted, restores exactly', back === 'Old nas2.example.local and 10.0.0.5; new nas2.example.local, 10.0.0.5, bob2, bob@example.com and nas2.example.local.', back);
  check('a full masked text with new tokens restores to the raw text', p.restore(second) === raw.replace('Hunter2!x', '[SECRET_1]'), p.restore(second));

  // Merge: a root with members moves its whole group.
  const q = loadPage({ domains: ['example.local'] });
  q.mask('a.example.local b.example.local c.example.local 10.0.0.9');
  const Q = q.PM;
  Q.group('[HOST_2]', '[HOST_1]'); Q.group('[PRIVATE_IP_1]', '[HOST_1]');
  const m = Q.group('[HOST_1]', '[HOST_3]');
  check('grouping a root moves its whole group', m.ok && m.moved.map(x => x.to).join() === '[HOST_3.2],[HOST_3.3],[HOST_PRIVATE_IP_3]', JSON.stringify(m));
  check('after a merge every value restores through every token it had', q.restore('[HOST_1] [HOST_1.2] [HOST_3.3] [HOST_PRIVATE_IP_1] [HOST_PRIVATE_IP_3]') === 'a.example.local b.example.local b.example.local 10.0.0.9 10.0.0.9');

  // Ungroup returns the value to its first token; the grouped token stays an alias.
  const u = Q.ungroup('[HOST_3.3]');
  const after = q.mask('b.example.local');
  check('ungroup returns the value to its first token', u.ok && u.token === '[HOST_2]' && after === '[HOST_2]' && q.restore('[HOST_3.3] [HOST_1.2]') === 'b.example.local b.example.local', JSON.stringify(u) + ' ' + after);
  check('ungroup of a token not in a group is refused', !Q.ungroup('[HOST_3]').ok);
  // Entity forms follow the group: a listed username grouped into a host.
  const e = loadPage({ domains: ['example.local'], terms: ['Jane Doe | PERSON'] });
  e.mask('ws01.example.local CORP\\jdoe');
  const eg = e.PM.group('[PERSON_USER_1]', '[HOST_1]');
  const em = e.mask('again CORP\\jdoe and C:\\Users\\jdoe');
  check('entity routing and the entity passes use the group token', eg.token === '[HOST_PERSON_USER_1]' && em === 'again [NETBIOS_1]\\[HOST_PERSON_USER_1] and C:\\Users\\[HOST_PERSON_USER_1]', em);
  const rows = e.PM.rows().find(r => r.token === '[HOST_PERSON_USER_1]');
  check('rows carry group, root and alias information', rows.grouped && rows.root === '[HOST_1]' && rows.was.join() === '[PERSON_USER_1]' && rows.original === '[PERSON_USER_1]' && e.PM.rows().find(r => r.token === '[PERSON_USER_1]').aliasOf === '[HOST_PERSON_USER_1]');
  e.clear();
  const ec = e.mask('ws01.example.local CORP\\jdoe');
  check('End session clears groups', ec === '[HOST_1] [NETBIOS_1]\\[PERSON_USER_1]' && !e.PM.rows().some(r => r.grouped || r.alias), ec);
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
    if (!/^\[[A-Z][A-Z0-9_]*_\d+(?:\.\d+)?(?::\*{4}\d{4})?\]$/.test(shown) || !shown.startsWith(sp.token.slice(0, -1))) problems.push(`span ${sp.start}-${sp.end} shows "${shown}" for ${sp.token}`);
    if (!p.PM.lookup(sp.token)) problems.push(`span token ${sp.token} is not in the mapping`);
    prev = sp.end;
  }
  const inText = (m.text.match(/\[[A-Z][A-Z0-9_]*_\d+(?:\.\d+)?(?::\*{4}\d{4})?\]/g) || []).length;
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
  const user = rows.find(x => x.label === 'PERSON_USER' && x.value === 'jdoe');
  rows.every(x => x.oneWay === (x.value === null)) && user && user.seen >= 3 && user.entity && user.part === 'USER'
    ? ok('mapping rows carry type, value and times seen') : fail('mapping rows carry type, value and times seen', JSON.stringify(user));
}

// ---- 6. Field and page hardening (static checks on the whole file) ----
{
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const engine = scriptBlock('engine'), ui = scriptBlock('ui');
  const REQUIRED = ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"', 'translate="no"',
    'writingsuggestions="false"', 'data-gramm="false"', 'data-gramm_editor="false"', 'data-enable-grammarly="false"', 'data-lt-active="false"', 'data-ms-editor="false"'];
  const fields = html.match(/<(?:textarea|input|select)\b[^>]*>/g) || [];
  const textFields = fields.filter(f => /^<(?:textarea|select)/.test(f) || /type="(?:text|search|password)"/.test(f) || !/type=/.test(f));
  const missing = textFields.flatMap(f => REQUIRED.filter(a => !f.includes(a)).map(a => `${(f.match(/id="([^"]+)"/) || [])[1]} lacks ${a}`));
  missing.length || !textFields.length ? fail('every text field and select is hardened', missing.join('; ') || 'no text fields found') : ok('every text field and select is hardened', `${textFields.length} fields`);
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
