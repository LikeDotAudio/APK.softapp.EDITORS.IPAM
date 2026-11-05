// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* discoveredTable.js — "On the network": what the bus already knows, in one APKTable.

   The things come from APKSoftapp.discovered() (vendor/apk-softapp): scanners,
   agents and presence merged by identity (MAC, else serial, else the agent's
   name — never an IP), each judged good / kinda / dead and re-judged every
   15 s, so trust decays on screen. Which things are shown is the app's
   config/discovery.json `kinds`, never a list in this file. No SDK, no bus or
   no broker: the status line says so and the editor still works on files.

   thingRow() is pure (the tests drive it); mountDiscovered() is the DOM. */

/** One discovered thing as a table row (text only; the live cell is drawn by liveCell). */
export function thingRow(t) {
  const live = t.live || { state: 'kinda', why: 'never verified' };
  return {
    id: t.id,
    state: live.state,
    why: live.why,
    name: t.name || '',
    model: [t.vendor, t.model].filter(Boolean).join(' '),
    identity: t.mac || t.serial || (t.agent ? t.agent.node : '') || '',
    ips: (t.ips || []).join(', '),
    seenBy: (t.protocols || []).join(', '),
  };
}

/** The good / kinda / dead dot, with its reason as text beside it. A Node, never HTML. */
export function liveCell(doc, row) {
  const s = doc.createElement('span');
  s.className = 'apk-live';
  s.setAttribute('data-apk-state', row.state);
  s.title = row.why;
  s.textContent = row.state;
  return s;
}

export const THING_COLUMNS = [
  { key: 'name', label: 'Name', editable: false },
  { key: 'model', label: 'Make / model', editable: false },
  { key: 'identity', label: 'MAC / serial', editable: false, mono: true },
  { key: 'ips', label: 'Address', editable: false, mono: true },
  { key: 'seenBy', label: 'Seen by', editable: false },
  { key: 'why', label: 'Why', editable: false },
];

/** Read the app's discovery tunables (config/discovery.json beside js/). */
export async function loadRules(base) {
  const res = await fetch(new URL('../config/discovery.json', base));
  if (!res.ok) throw new Error(`${res.status} reading config/discovery.json`);
  return res.json();
}

/**
 * Mount the table. opts: { host, status, id, kinds, columns?, toRows?, action?, empty? }
 *   action: { label, run(thing) } adds a button per row (e.g. "Load", "Add").
 * Resolves the APKSoftapp.discovered() handle (ok: false when there is no bus).
 */
export async function mountDiscovered(opts) {
  const win = opts.win || window;
  const doc = win.document;
  const S = win.APKSoftapp;
  const say = (state, text) => {
    if (!opts.status) return;
    opts.status.setAttribute('data-apk-state', state);
    opts.status.textContent = text;
  };
  if (!S || !win.APKTable) {
    say('dead', 'vendor/apk-softapp or vendor/apk-table did not load.');
    return { ok: false, things: () => [] };
  }
  let things = [];
  const columns = [
    { key: 'state', label: 'Live', render: (v, row) => liveCell(doc, row) },
    ...(opts.columns || THING_COLUMNS),
  ];
  if (opts.action) {
    columns.push({
      key: '_act', label: '', render: (v, row) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'apk-table-btn';
        b.textContent = opts.action.label;
        b.onclick = () => { const t = things.find((x) => x.id === row.id); if (t) opts.action.run(t); };
        return b;
      },
    });
  }
  const table = win.APKTable.create(opts.host, {
    id: opts.id, columns, rows: [], editable: false,
    empty: opts.empty || 'Nothing on the bus matches yet.',
    searchPlaceholder: 'name, MAC, address',
  });
  const toRows = opts.toRows || ((list) => list.map(thingRow));
  const draw = (list) => {
    things = list;
    table.setRows(toRows(list));
    const n = (s) => list.filter((t) => t.live && t.live.state === s).length;
    say(list.length ? 'good' : 'kinda',
      `${list.length} on the bus · ${n('good')} verified · ${n('kinda')} not re-verified · ${n('dead')} dead`);
    if (opts.onChange) opts.onChange(list);
  };
  say('kinda', 'Connecting to the bus…');
  const d = await S.discovered({ kinds: opts.kinds || [], onChange: draw });
  if (!d.ok) { say('dead', d.reason); return d; }
  draw(d.things());
  return Object.assign(d, { table });
}
