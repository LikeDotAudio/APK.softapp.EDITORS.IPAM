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

test('IpamModel exports and imports block schemas correctly', () => {
  const ipam = new IpamModel('STUDIO-NET');
  ipam.addSubnet({ cidr: '172.16.0.0/16', vlan: 50, name: 'AES67 Fabric', gateway: '172.16.0.1', allocated: 300, total: 65534 });

  const block = ipam.toBlock();
  assert.equal(block.type, 'ipam_scope');
  assert.equal(block.scopeName, 'STUDIO-NET');
  assert.equal(block.subnets.length, 5);

  const restored = new IpamModel();
  restored.fromBlock(block);
  assert.equal(restored.scopeName, 'STUDIO-NET');
  assert.equal(restored.subnets.length, 5);
  assert.equal(restored.subnets[4].cidr, '172.16.0.0/16');
});
