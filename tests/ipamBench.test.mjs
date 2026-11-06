// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { subnetsToSystems, systemsToSubnets, saveSubnets, loadSystems, exportSiteIfc, hostsIn } from '../js/ipamBench.js';

// The plan on the bench (network-discovery-3/7): the IPAM rows round-trip through
// /api/bim/bench/systems, a VLAN another editor filled keeps its members, every row has its GlobalId.

const GUID = /^[0-3][0-9A-Za-z_$]{21}$/;
const SUBNETS = [
  { cidr: '10.10.10.0/24', vlan: 10, name: 'Dante Primary Audio', gateway: '10.10.10.1', allocated: 48, total: 254 },
  { cidr: '10.10.100.0/23', vlan: 100, name: 'SMPTE 2110 Video', gateway: '10.10.100.1', allocated: 120, total: 510 },
];

/** A stand-in for DATABASE.server.BIM's bench systems routes, holding rows as bim/network.py does. */
function bench(initial = []) {
  const rows = new Map(initial.map(r => [r.id, r]));
  const calls = [];
  const guid = (id) => `2${id.replace(/[^0-9A-Za-z]/g, '').padEnd(21, 'x').slice(0, 21)}`;
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const m = url.match(/\/bench\/systems(?:\/(.+))?$/);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
    if (!m) return url.endsWith('/site.ifc') ? { ok: true, status: 200, text: async () => 'ISO-10303-21;' } : { ok: false, status: 404, json: async () => ({}) };
    const id = m[1] && decodeURIComponent(m[1]);
    if (init.method === 'PUT') { rows.set(id, { id, ...JSON.parse(init.body) }); return ok(rows.get(id)); }
    if (init.method === 'DELETE') { rows.delete(id); return ok({ deleted: id }); }
    return ok({ items: [...rows.values()].map(r => ({ ...r, guid: guid(r.id) })) });
  };
  return { impl, rows, calls };
}

test('subnet rows become a VLAN + a nested subnet each, VLANs first', () => {
  const { puts, deletes } = subnetsToSystems(SUBNETS);
  assert.deepEqual(puts.map(p => `${p.kind}:${p.id}`), ['vlan:V10', 'vlan:V100', 'subnet:S-10-10-10-0-24', 'subnet:S-10-10-100-0-23']);
  assert.deepEqual(puts[2], { id: 'S-10-10-10-0-24', kind: 'subnet', parent: 'V10', cidr: '10.10.10.0/24', name: 'Dante Primary Audio', gateway: '10.10.10.1' });
  assert.deepEqual(deletes, []);
  assert.throws(() => subnetsToSystems([{ cidr: '10.0.0.0/8', vlan: 0 }]), /1\.\.4094/);
});

test('a round trip through the bench loses nothing the plan holds; counts are derived', async () => {
  const b = bench();
  const items = await saveSubnets(SUBNETS, { api: '/api/bim', fetchImpl: b.impl });
  const back = systemsToSubnets(items, SUBNETS);
  for (const [i, s] of SUBNETS.entries()) {
    assert.deepEqual({ cidr: back[i].cidr, vlan: back[i].vlan, name: back[i].name, gateway: back[i].gateway, allocated: back[i].allocated },
      { cidr: s.cidr, vlan: s.vlan, name: s.name, gateway: s.gateway, allocated: s.allocated });
    assert.match(back[i].guid, GUID);
  }
  assert.equal(back[1].total, hostsIn('10.10.100.0/23'));
  assert.equal(hostsIn('10.10.100.0/23'), 510);
  // again: same ids, nothing removed
  b.calls.length = 0;
  await saveSubnets(SUBNETS, { api: '/api/bim', fetchImpl: b.impl });
  assert.equal(b.calls.filter(c => c.method === 'DELETE').length, 0);
  assert.equal(b.rows.size, 4);
});

test('a VLAN the Switch filled keeps its members and profile; a removed row is deleted, its VLAN kept', async () => {
  const b = bench([
    { id: 'V10', kind: 'vlan', vlan_id: 10, name: 'old', dscp: 46, profile: 'Dante', members: [{ ref: 'U3', pin: 'U3:N1' }] },
    { id: 'S-old', kind: 'subnet', parent: 'V10', cidr: '10.20.0.0/16' },
  ]);
  await saveSubnets([SUBNETS[0]], { api: '/api/bim', fetchImpl: b.impl });
  assert.deepEqual(b.rows.get('V10'), { id: 'V10', kind: 'vlan', vlan_id: 10, name: 'Dante Primary Audio', dscp: 46, profile: 'Dante', members: [{ ref: 'U3', pin: 'U3:N1' }] });
  assert.equal(b.rows.has('S-old'), false);
  assert.equal(b.calls.at(-2).method, 'DELETE');
  assert.deepEqual((await loadSystems({ api: '/api/bim', fetchImpl: b.impl })).map(s => s.id), ['V10', 'S-10-10-10-0-24']);
});

test('Export IFC is GET /api/bim/site.ifc', async () => {
  const b = bench();
  assert.equal(await exportSiteIfc({ api: '/api/bim', fetchImpl: b.impl }), 'ISO-10303-21;');
  assert.equal(b.calls[0].url, '/api/bim/site.ifc');
});
