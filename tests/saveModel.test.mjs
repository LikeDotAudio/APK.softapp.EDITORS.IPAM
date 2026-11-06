// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
// ROAD-3583: standalone, Save & Return is Save Model — the block (.json) and its .ifc twin, the bench's site
// model (GET /api/bim/site.ifc, the BIM server's writer), both or neither; in the CAD, the block as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { world } from './softappWorld.mjs';
import { saveWithSiteTwin } from '../js/ipamBench.js';

const SITE = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4X3_ADD2'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
const BLOCK = { type: 'test', id: 'scope_lab', systems: ['V10'] };
const site = (status = 200) => async (url) => {
  assert.equal(url, '/api/bim/site.ifc');
  return { ok: status === 200, status, text: async () => SITE };
};

test('standalone: the block and the bench site model download together, the .ifc first', async () => {
  const w = world({ framed: false });
  const host = w.S.connectHost({ editor: 'Test', blockType: 'test', notice: false });
  const via = await saveWithSiteTwin(w.S, host, BLOCK, { filename: 'scope_lab' }, { api: '/api/bim', fetchImpl: site() });
  assert.equal(via, 'download');
  assert.deepEqual(w.downloads.map((d) => d.name), ['scope_lab.ifc', 'scope_lab.json']);
  assert.equal(w.downloads[0].text, SITE);
  assert.deepEqual(JSON.parse(w.downloads[1].text), BLOCK);
});

test('standalone, no site model from the bench: neither file is written', async () => {
  const w = world({ framed: false });
  const host = w.S.connectHost({ editor: 'Test', blockType: 'test', notice: false });
  const shown = [];
  const S = Object.assign(Object.create(w.S), { showProblem: (p) => shown.push(p) });   // the stub window draws no card
  const via = await saveWithSiteTwin(S, host, BLOCK, { filename: 'scope_lab' }, { api: '/api/bim', fetchImpl: site(503) });
  assert.equal(via, '');
  assert.deepEqual(w.downloads, []);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].code, 'save_failed');
});

test('in the CAD: the block goes back as blockSave, no file and no site fetch', async () => {
  const w = world();
  const host = w.S.connectHost({ editor: 'Test', blockType: 'test', notice: false });
  const via = await saveWithSiteTwin(w.S, host, BLOCK, { filename: 'scope_lab' }, { fetchImpl: () => assert.fail('no fetch in the CAD') });
  assert.equal(via, 'host');
  assert.equal(w.toParent.at(-1).m.type, 'blockSave');
  assert.deepEqual(w.downloads, []);
});
