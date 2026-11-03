import test from 'node:test';
import assert from 'node:assert/strict';
import { IpamModel } from '../js/ipamApp.js';

test('IpamModel tracks subnets and utilization', () => {
  const ipam = new IpamModel();
  assert.equal(ipam.subnets.length, 4);

  ipam.addSubnet({ cidr: '192.168.10.0/24', vlan: 5, name: 'Guest Wi-Fi', gateway: '192.168.10.1', allocated: 20, total: 254 });
  assert.equal(ipam.subnets.length, 5);
  assert.equal(ipam.subnets[4].cidr, '192.168.10.0/24');
});
