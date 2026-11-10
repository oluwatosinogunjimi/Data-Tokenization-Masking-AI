#!/usr/bin/env node
// Public-safety lint: keeps real-looking data out of the repo. `node tests/public-safety.js`
// Flags GUIDs not on the safe list, email domains that are not documentation examples, public IPv4/IPv6
// addresses outside documentation ranges, and any term from a private denylist (never committed):
// one term per line in .public-safety-denylist, or a newline-separated PUBLIC_SAFETY_DENYLIST env var.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_EXT = /\.(html?|js|md|json|ya?ml|txt|css)$/i;

const SAFE_GUIDS = new Set([
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301', // textbook example GUID
  '11112222-3333-4444-5555-666677778888',
  '9c1e8a7b-1d2e-4f3a-8b9c-0d1e2f3a4b5c',
  '00000000-0000-0000-0000-000000000000',
]);
const SAFE_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net|co\.uk|local)|contoso\.com|fabrikam\.com|example|test|invalid|localhost|example\.onmicrosoft\.com|contoso\.onmicrosoft\.com)$/i;
const SAFE_IPV4 = new Set(['1.2.3.4', '0.0.0.0', '255.255.255.255']);

function isSafeIpv4(ip){
  const [a, b, c] = ip.split('.').map(Number);
  if (SAFE_IPV4.has(ip)) return true;
  if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return true;
  return (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}

function files(dir){
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })){
    if (e.isDirectory()){ if (!SKIP_DIRS.has(e.name)) out.push(...files(path.join(dir, e.name))); }
    else if (TEXT_EXT.test(e.name) || e.name === 'LICENSE') out.push(path.join(dir, e.name));
  }
  return out;
}

function denylist(){
  const p = path.join(ROOT, '.public-safety-denylist');
  const lines = [...(fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : []), ...(process.env.PUBLIC_SAFETY_DENYLIST || '').split(/\r?\n/)];
  return lines.map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#'));
}

const problems = [];
const deny = denylist();
for (const f of files(ROOT)){
  if (path.basename(f) === 'public-safety.js') continue;   // holds the safe lists themselves
  const rel = path.relative(ROOT, f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    // Un-escape so "C:\\Users" in JS source reads the same as the text a user would paste.
    const line = raw.replace(/\\\\/g, '\\');
    const at = `${rel}:${i + 1}`;
    for (const g of line.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) || [])
      if (!SAFE_GUIDS.has(g.toLowerCase())) problems.push(`${at} GUID not on the safe list: ${g}`);
    for (const m of line.matchAll(/\b[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g))
      if (!SAFE_EMAIL_DOMAIN.test(m[1])) problems.push(`${at} email domain is not a documentation example: ${m[0]}`);
    for (const ip of line.match(/(?<![\d.])(?:\d{1,3}(?:\.|\[\.\]|\(\.\))){3}\d{1,3}(?![\d.])/g) || []){
      const clean = ip.replace(/\[\.\]|\(\.\)/g, '.');
      if (clean.split('.').every(o => +o <= 255) && !isSafeIpv4(clean)) problems.push(`${at} public IPv4 outside documentation ranges: ${ip}`);
    }
    for (const ip of line.match(/(?<![0-9a-f:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])/gi) || []){
      const l = ip.toLowerCase();
      if (/^(2|3)[0-9a-f]{3}:/.test(l) && !l.startsWith('2001:db8:')) problems.push(`${at} public IPv6 outside 2001:db8::/32: ${ip}`);
    }
    const low = line.toLowerCase();
    for (const term of deny) if (low.includes(term)) problems.push(`${at} denylisted term (line hidden)`);
  });
}

if (problems.length){ console.log(problems.join('\n')); console.log(`\n${problems.length} public-safety problem(s)`); process.exitCode = 1; }
else console.log(`public safety: ok (${files(ROOT).length} files checked${deny.length ? `, ${deny.length} denylist terms` : ', no denylist found'})`);
