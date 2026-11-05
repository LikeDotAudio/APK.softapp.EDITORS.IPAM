// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* ROAD-3488: the ipam_scope block goes in and out over cad.like.audio/host@1
   (vendor/apk-softapp), never '*'; the addresses the bus has seen are held
   against the subnets by identity (MAC), never counted twice by address. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { world, hostContract, discovery, ORIGIN } from './softappWorld.mjs';
import { IpamModel } from '../js/ipamModel.js';
import { sightings, inCidr, suggestCidr, subnetFor, hostsIn } from '../js/ipamDiscovered.js';

const rules = JSON.parse(fs.readFileSync(new URL('../config/discovery.json', import.meta.url)));

function editor(S) {
  const model = new IpamModel();
  const host = S.connectHost({
    editor: 'IPAM Manager', blockType: 'ipam_scope', notice: false,
    onLoad: (block) => model.fromBlock(block),
    onRequest: () => ({ block: model.toBlock(), meta: { name: model.scopeName } }),
  });
  return { model, host };
}

test('block round trip: load from the CAD, edit, request answers blockSave with the edit, at our origin', async () => {
  const { S, toParent, fire } = world();
  const { model } = editor(S);
  const sent = new IpamModel('STUDIO-B');
  sent.subnets = [{ cidr: '10.1.0.0/24', vlan: 11, name: 'Dante A', gateway: '10.1.0.1', allocated: 3, total: 254 }];
  fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: sent.toBlock(), meta: { blockName: 'IPAM_B' } });
  assert.equal(model.scopeName, 'STUDIO-B');
  assert.equal(model.subnets.length, 1);
  model.updateSubnet(0, 'vlan', '12');
  fire({ protocol: 'cad.like.audio/host@1', type: 'request' });
  const save = toParent.at(-1);
  assert.equal(save.o, ORIGIN);
  assert.equal(save.m.type, 'blockSave');
  assert.equal(save.m.blockType, 'ipam_scope');
  assert.equal(save.m.block.subnets[0].vlan, 12);
  assert.equal(save.m.meta.blockName, 'IPAM_B');
  const contract = await hostContract();
  if (contract) for (const { m } of toParent) assert.deepEqual(contract.validateMessage(contract.schema, 'toCad', m), [], m.type);
});

test('only window.parent at our origin speaks to the editor; the old APK_LOAD_BLOCK is ignored', () => {
  const { S, fire } = world();
  const { model } = editor(S);
  fire({ type: 'APK_LOAD_BLOCK', block: { scopeName: 'OLD' } });
  fire({ protocol: 'cad.like.audio/host@1', type: 'load', block: { scopeName: 'X' } }, { source: {} });
  assert.equal(model.scopeName, 'ENTERPRISE-AV-NETWORK');
});

test('cidr arithmetic', () => {
  assert.ok(inCidr('10.10.101.7', '10.10.100.0/23'));
  assert.ok(!inCidr('10.10.102.7', '10.10.100.0/23'));
  assert.ok(!inCidr('nope', '10.0.0.0/8'));
  assert.equal(suggestCidr('192.168.7.42', 24), '192.168.7.0/24');
  assert.equal(hostsIn(24), 254);
  assert.equal(hostsIn(31), 2);
  assert.deepEqual(subnetFor('192.168.7.0/24', 2), { cidr: '192.168.7.0/24', vlan: 0, name: 'Seen on the network', gateway: '', allocated: 2, total: 254 });
});

test('the bus: one NIC seen by two protocols counts once; a dead one is not in use; an unplanned address gets a subnet', () => {
  const { S, win } = world({ contracts: true });
  if (!win.APKContracts) return;
  const now = Date.parse('2026-11-04T12:00:00Z');
  const { model: disc, roots } = discovery(S, win, now);
  const P = roots.protocols;
  // the same MAC through arp and mdns, at one address
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_01/mac`, 'aa:bb:cc:00:00:01');
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_01/ip`, '10.10.10.20');
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_01/state`, 'reachable');
  disc.ingest(`${P}/mdns/Device/stagebox/mac`, 'aa:bb:cc:00:00:01');
  disc.ingest(`${P}/mdns/Device/stagebox/ip`, '10.10.10.20');
  // a lost one in the same subnet
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_02/mac`, 'aa:bb:cc:00:00:02');
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_02/ip`, '10.10.10.21');
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_02/state`, 'failed');
  // one nobody planned
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_03/mac`, 'aa:bb:cc:00:00:03');
  disc.ingest(`${P}/arp/Device/aa_bb_cc_00_00_03/ip`, '172.20.4.9');
  const things = disc.things();
  assert.equal(things.length, 3);

  const model = new IpamModel();
  const { per, unplaced } = sightings(model.subnets, things, rules);
  assert.equal(per[0].seen, 1, 'one identity, counted once');
  assert.equal(per[0].dead, 1, 'the lost one is not in use');
  assert.deepEqual(per.slice(1).map((p) => p.seen), [0, 0, 0]);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].cidr, '172.20.4.0/24');
  assert.equal(unplaced[0].thing.mac, 'aa:bb:cc:00:00:03');
});
