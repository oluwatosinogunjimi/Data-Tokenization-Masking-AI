// Loads the engine block of paste-masker.html (<script id="engine">) into a Node VM with no DOM at all, and
// drives it through PM, the same interface the page uses. No browser and no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'paste-masker.html');
const html = () => fs.readFileSync(HTML_PATH, 'utf8');

function scriptBlock(id){
  const m = html().match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!m) throw new Error(`no <script id="${id}"> block in paste-masker.html`);
  return m[1];
}

// A fresh engine. opts: { off: [group], keepEmailDomain, keepPublicIp, terms: [line], domains: [line], allow: [line] }
function loadEngine(opts = {}){
  const ctx = vm.createContext({});   // no document, window or navigator: the engine must not need them
  vm.runInContext(scriptBlock('engine'), ctx, { filename: 'paste-masker.html#engine' });
  const PM = vm.runInContext('PM', ctx);
  const on = {};
  for (const g of opts.off || []) on[g] = false;
  PM.configure({ on, keepEmailDomain: !!opts.keepEmailDomain, keepPublicIp: !!opts.keepPublicIp,
    terms: opts.terms || [], domains: opts.domains || [], allow: opts.allow || [] });
  return PM;
}

// The same engine with string-in, string-out helpers for the tests.
function loadPage(opts = {}){
  const PM = loadEngine(opts);
  let last = null;
  return {
    PM,
    mask: text => PM.mask(text).text,
    restore(text){ last = PM.restore(text); return last.text; },
    lastRestore: () => last,
    clear: () => PM.clear(),
    // What "Load sample" does: the sample's terms and domains, then Mask.
    sample(){
      PM.configure({ terms: PM.sample.terms, domains: PM.sample.domains });
      return { input: PM.sample.text, output: PM.mask(PM.sample.text).text };
    },
  };
}

module.exports = { loadEngine, loadPage, scriptBlock, HTML_PATH };
