// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* softappWorld.mjs — the vendored APKSoftapp client (vendor/apk-softapp) run
   in a stub window, the way FrontEnd/shared/apk-softapp.test.js drives it
   (world() / fire()). Framed: there is a parent that records what it is sent.
   hostContract() is the CAD's published host@1 schema and validator when the
   CAD checkout sits beside this app in the monorepo, else null (skip). */
import fs from 'node:fs';
import vm from 'node:vm';

export const ORIGIN = 'http://bench:8080';
const SRC = fs.readFileSync(new URL('../vendor/apk-softapp/apk-softapp.js', import.meta.url), 'utf8');
const CONTRACTS = new URL('../vendor/apk-contracts/apk-contracts.global.js', import.meta.url);
const HOST_DIR = new URL('../../EDITORS.CAD.Like.audio/contract/', import.meta.url);

export function world({ framed = true, contracts = false } = {}) {
  const listeners = [];
  const toParent = [];
  const downloads = [];
  const body = { children: [], appendChild(n) { this.children.push(n); return n; } };
  const doc = {
    title: 'Test Editor',
    body,
    documentElement: { style: { setProperty() {} } },
    getElementById: (id) => body.children.find((n) => n.id === id) || null,
    createElement: (tag) => ({
      tag, style: {}, attrs: {}, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      click() { downloads.push({ name: this.download, href: this.href }); },
      remove() {},
    }),
  };
  const win = {
    location: { origin: ORIGIN },
    document: doc,
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    Blob: class { constructor(parts, o) { this.text = parts.join(''); this.type = o.type; } },
    URL: { createObjectURL: (b) => { downloads.blob = b; return 'blob:1'; }, revokeObjectURL() {} },
    setTimeout: (fn) => { fn(); return 1; },
    setInterval: () => 1, clearInterval() {},
    JSON, Date, Math, Promise, Object, Array, String, Number, isFinite, parseInt, RegExp,
  };
  win.window = win; win.globalThis = win;
  const parent = { postMessage: (m, o) => toParent.push({ m: JSON.parse(JSON.stringify(m)), o }) };
  win.parent = framed ? parent : win;
  if (contracts && fs.existsSync(CONTRACTS)) vm.runInNewContext(fs.readFileSync(CONTRACTS, 'utf8'), win);
  vm.runInNewContext(SRC, win);
  const fire = (data, { source = parent, origin = ORIGIN } = {}) =>
    listeners.slice().forEach((fn) => fn({ data, source, origin }));
  return { win, S: win.APKSoftapp, toParent, downloads, fire, parent };
}

/** { schema, validateMessage } from the CAD's contract/host@1, or null when the CAD is not checked out beside us. */
export async function hostContract() {
  const schemaUrl = new URL('host@1/host.schema.json', HOST_DIR);
  if (!fs.existsSync(schemaUrl)) return null;
  const { validateMessage } = await import(new URL('validate.mjs', HOST_DIR).href);
  return { schema: JSON.parse(fs.readFileSync(schemaUrl, 'utf8')), validateMessage };
}

/** A discovery model (APKSoftapp.createDiscovery) on the contract's real topic roots, for fixtures. */
export function discovery(S, win, now) {
  const C = win.APKContracts;
  const strip = (t) => String(t).replace(/\/#$/, '');
  const roots = { protocols: strip(C.Topics.protocols.wildcard()), bareMetal: C.Topics.bareMetal.ROOT, discovery: strip(C.Topics.discoveryWildcard()) };
  return { model: S.createDiscovery({ roots, presenceActive: C.discoveryPresenceActive, now: () => now }), roots, C };
}
