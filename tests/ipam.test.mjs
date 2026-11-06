import test from 'node:test';
import assert from 'node:assert/strict';
import { IpamModel } from '../js/ipamModel.js';

test('IpamModel tracks subnets and utilization', () => {
  const ipam = new IpamModel();
  assert.equal(ipam.subnets.length, 4);

  ipam.addSubnet({ cidr: '192.168.10.0/24', vlan: 5, name: 'Guest Wi-Fi', gateway: '192.168.10.1', allocated: 20, total: 254 });
  assert.equal(ipam.subnets.length, 5);
  assert.equal(ipam.subnets[4].cidr, '192.168.10.0/24');
});

test('the block keeps only the bench ids its rows plan; an old block with subnets[] still loads', () => {
  const ipam = new IpamModel('STUDIO-NET');
  ipam.addSubnet({ cidr: '172.16.0.0/16', vlan: 50, name: 'AES67 Fabric', gateway: '172.16.0.1', allocated: 300, total: 65534 });

  const block = ipam.toBlock();
  assert.equal(block.type, 'ipam_scope');
  assert.equal(block.scopeName, 'STUDIO-NET');
  assert.equal(block.subnets, undefined, 'no private copy of the plan (ROAD-3582)');
  assert.deepEqual(block.systems, ['V10', 'V20', 'V30', 'V100', 'V50',
    'S-10-10-10-0-24', 'S-10-10-20-0-24', 'S-10-10-30-0-24', 'S-10-10-100-0-23', 'S-172-16-0-0-16']);

  const restored = new IpamModel();
  restored.fromBlock(block);
  assert.equal(restored.scopeName, 'STUDIO-NET');
  assert.deepEqual(restored.systems, block.systems);
  assert.equal(restored.subnets.length, 0, 'the rows come from the bench (IpamApp.loadScope)');

  const old = new IpamModel();
  old.fromBlock({ type: 'ipam_scope', scopeName: 'OLD', subnets: [{ cidr: '10.9.0.0/24', vlan: 9, name: 'Old', gateway: '10.9.0.1', allocated: 1, total: 254 }] });
  assert.equal(old.legacy, true);
  assert.equal(old.subnets[0].cidr, '10.9.0.0/24');
  assert.deepEqual(old.toBlock().systems, ['V9', 'S-10-9-0-0-24'], 'saved again, an old block becomes ids');
});
