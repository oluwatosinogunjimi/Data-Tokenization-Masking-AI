// Loads paste-masker.html's script into a Node VM with a small DOM stub, so tests drive the real page
// code (readCfg, the buttons, maskText, restoreText) without a browser or any dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'paste-masker.html');
const GROUPS = ['secrets', 'cards', 'bvn', 'account', 'phones', 'emails', 'users', 'hosts', 'guids', 'sids', 'macs', 'ips'];

function loadPage(opts = {}){
  const html = fs.readFileSync(HTML, 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, value: '', checked: false, textContent: '', className: '', dataset: {}, handlers: {},
    addEventListener(type, fn){ this.handlers[type] = fn; },
    appendChild(){}, append(){}, setAttribute(){}, removeAttribute(){}, select(){},
  });
  const off = new Set(opts.off || []);
  const boxes = GROUPS.map(g => ({ dataset: { g }, checked: !off.has(g) }));
  const winHandlers = {};
  const ctx = {
    console, setTimeout, navigator: {}, confirm: () => true,
    addEventListener(type, fn){ winHandlers[type] = fn; },
    document: {
      getElementById: el,
      querySelectorAll: () => boxes,
      createElement: () => el('tmp' + Math.random()),
      execCommand(){},
    },
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: 'paste-masker.html' });

  el('domains').value = (opts.domains || []).join('\n');
  el('terms').value = (opts.terms || []).join('\n');
  el('allow').value = (opts.allow || []).join('\n');
  el('keepEmailDomain').checked = !!opts.keepEmailDomain;
  el('keepPublicIp').checked = !!opts.keepPublicIp;

  return {
    mask(text){ el('input').value = text; el('maskBtn').handlers.click(); return el('output').value; },
    restore(text){ el('reply').value = text; el('restoreBtn').handlers.click(); return el('restored').value; },
    clear(){ el('clearMapBtn').handlers.click(); },
    sample(){ el('sampleBtn').handlers.click(); return { input: el('input').value, output: el('output').value }; },
    stats(){ return el('stats').textContent; },
    restoreStats(){ return el('restoreStats').textContent; },
    pagehide(){ winHandlers.pagehide && winHandlers.pagehide(); },
    field(id){ return el(id).value; },
  };
}

module.exports = { loadPage, GROUPS };
