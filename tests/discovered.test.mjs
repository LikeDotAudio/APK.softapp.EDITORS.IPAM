// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* discovered.test.mjs — THE Discovered panel test, byte-identical in every
   editor whose panel is APKSoftapp.discoveredPanel (ROAD-3502; the panel
   itself is tested in WEB.Frontend-Assets shared/apk-softapp.test.js). Each
   editor is its own repo, so this runs on what the app ships: its vendored
   vendor/apk-softapp + vendor/apk-contracts and its own config/discovered.json
   (or config/discovery.json). It holds the app's tunables to the shared
   checker, and the panel to the owner's rules on them: identity is the MAC or
   serial, never an IP; nothing is listed without a bus; nothing unverified is
   good. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APP = new URL('../', import.meta.url);
const CONFIG = ['config/discovered.json', 'config/discovery.json'].find((p) => fs.existsSync(new URL(p, APP)));
const CONFIG_TEXT = fs.readFileSync(new URL(CONFIG, APP), 'utf8');
const SRC = fs.readFileSync(new URL('vendor/apk-softapp/apk-softapp.js', APP), 'utf8');
const CONTRACTS = fs.readFileSync(new URL('vendor/apk-contracts/apk-contracts.global.js', APP), 'utf8');
const NOW = Date.parse('2026-11-04T12:00:00Z');

function node(tag) {
  return {
    tag, attrs: {}, style: {}, children: [], handlers: {}, _text: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    replaceChildren(...c) { this.children = []; c.forEach((x) => this.appendChild(x)); },
    addEventListener(t, fn) { this.handlers[t] = fn; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); },
    set textContent(v) { this._text = String(v); this.children = []; },
  };
}

/* A window with this app's vendored client, its config served, and (bus) a broker. */
function world({ bus = true } = {}) {
  const subs = [];
  const link = {
    connected: true,
    subscribe(filter, cb) { const s = { filter, cb }; subs.push(s); return () => subs.splice(subs.indexOf(s), 1); },
    on() { return this; },
  };
  const match = (f, t) => {
    f = f.split('/'); t = t.split('/');
    for (let i = 0; i < f.length; i++) { if (f[i] === '#') return true; if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false; }
    return f.length === t.length;
  };
  const send = (topic, text) => subs.slice().forEach((s) => { if (match(s.filter, topic)) s.cb(topic, text); });
  const body = node('body');
  const doc = { title: 'Test', body, documentElement: body, createElement: node, getElementById: () => null };
  const win = {
    location: { origin: 'http://bench:8080' }, document: doc, console: { warn() {} },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (url) => (String(url).endsWith(CONFIG)
      ? { ok: true, status: 200, text: async () => CONFIG_TEXT }
      : { ok: false, status: 404, statusText: 'Not Found', text: async () => '' }),
    JSON, Date, Math, Promise, Object, Array, String, Number, isFinite, parseInt, RegExp, Error, TypeError, SyntaxError,
  };
  win.window = win; win.globalThis = win; win.parent = win;
  vm.runInNewContext(CONTRACTS, win);
  if (bus) win.APKBus = { connect: async () => link };
  vm.runInNewContext(SRC, win);
  const tables = [];
  const table = { create: (host, o) => { const t = { o, rows: null, setRows(r) { this.rows = r; } }; tables.push(t); return t; } };
  const P = win.APKContracts.Topics.protocols.wildcard().replace(/\/#$/, '');
  const host = node('div');
  host.ownerDocument = doc;
  return { S: win.APKSoftapp, send, P, host, status: node('div'), table, tables };
}

test(`${CONFIG}: kinds (and collections) are lists of words, passed by the shared checker`, async () => {
  const { S } = world();
  const cfg = await S.discoveredConfig(`./${CONFIG}`, { required: true });
  assert.equal(cfg.problem, null, cfg.why);
  assert.ok(Array.isArray(cfg.kinds) && cfg.kinds.every((k) => typeof k === 'string' && k === k.trim() && k.length));
  if (cfg.collections) assert.ok(cfg.collections.includes('Device'), 'Device stays: every scanner files its things there');
});

test('the panel lists what the config names, keyed on the MAC — never the address — and not verified is never good', async () => {
  const w = world();
  const cfg = JSON.parse(CONFIG_TEXT);
  const picked = [];
  const panel = await w.S.discoveredPanel(w.host, {
    configUrl: `./${CONFIG}`, status: w.status, id: 'test-discovered', table: w.table,
    schedule: (fn) => { fn(); }, now: () => NOW, pickLabel: 'Pick', onPick: (t) => picked.push(t),
  });
  assert.ok(panel.ok, panel.reason);
  const kind = (cfg.kinds || [])[0] || 'anything';
  const dev = `${w.P}/ping/Device/ping_00_11_22_33_44_55`;
  w.send(`${dev}/device_class`, `Bench ${kind}`);
  w.send(`${dev}/ips`, '10.0.0.7');
  const other = `${w.P}/zz_none/Device/zz_none_00_11_22_33_44_66`;
  w.send(`${other}/device_class`, 'zz none');
  for (const c of (cfg.collections || []).filter((x) => x !== 'Device')) {
    w.send(`${w.P}/ping/${c}/ping_00_11_22_33_44_77/device_class`, `Bench ${kind}`);
  }
  const t = w.tables[0];
  const extra = (cfg.collections || []).filter((x) => x !== 'Device').length;
  assert.equal(t.rows.length, ((cfg.kinds || []).length ? 1 : 2) + extra, JSON.stringify(t.rows));
  const row = t.rows.find((r) => r.identity === '00:11:22:33:44:55');
  assert.ok(row, 'identity is the MAC');
  assert.ok(t.rows.every((r) => !/^\d+\.\d+\.\d+\.\d+$/.test(r.identity)), 'never an IP');
  assert.equal(row.ips, '10.0.0.7');
  assert.equal(row.state, 'kinda', 'seen, never verified: not good');
  t.o.columns.find((c) => c.key === '_pick').render('', row).handlers.click();
  assert.equal(picked[0].mac, '00:11:22:33:44:55');
  assert.equal(w.status.attrs['data-apk-state'], 'good');
  panel.stop();
});

test('no bus: the reason goes on screen, the table stays empty', async () => {
  const w = world({ bus: false });
  const panel = await w.S.discoveredPanel(w.host, { configUrl: `./${CONFIG}`, status: w.status, table: w.table });
  assert.equal(panel.ok, false);
  assert.equal(w.status.attrs['data-apk-state'], 'dead');
  assert.match(w.status.textContent, /bus|broker|SDK/i);
  assert.equal(w.tables[0].rows, null);
});
