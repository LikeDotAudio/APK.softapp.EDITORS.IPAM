// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export class IpamModel {
  constructor(scopeName = 'ENTERPRISE-AV-NETWORK') {
    this.scopeName = scopeName;
    this.subnets = [
      { cidr: '10.10.10.0/24', vlan: 10, name: 'Dante Primary Audio', gateway: '10.10.10.1', allocated: 48, total: 254 },
      { cidr: '10.10.20.0/24', vlan: 20, name: 'Dante Secondary Audio', gateway: '10.10.20.1', allocated: 48, total: 254 },
      { cidr: '10.10.30.0/24', vlan: 30, name: 'AV Control & Mon', gateway: '10.10.30.1', allocated: 32, total: 254 },
      { cidr: '10.10.100.0/23', vlan: 100, name: 'SMPTE 2110 Video', gateway: '10.10.100.1', allocated: 120, total: 510 }
    ];
  }

  addSubnet(subnet = {}) {
    const s = {
      cidr: subnet.cidr || '192.168.1.0/24',
      vlan: subnet.vlan !== undefined ? parseInt(subnet.vlan, 10) : 1,
      name: subnet.name || 'New AV Subnet',
      gateway: subnet.gateway || '192.168.1.1',
      allocated: subnet.allocated !== undefined ? parseInt(subnet.allocated, 10) : 1,
      total: subnet.total !== undefined ? parseInt(subnet.total, 10) : 254
    };
    this.subnets.push(s);
    return s;
  }

  removeSubnet(index) {
    if (index >= 0 && index < this.subnets.length) {
      return this.subnets.splice(index, 1)[0];
    }
    return null;
  }

  updateSubnet(index, field, value) {
    if (this.subnets[index]) {
      if (field === 'vlan' || field === 'allocated' || field === 'total') {
        this.subnets[index][field] = parseInt(value, 10) || 0;
      } else {
        this.subnets[index][field] = value;
      }
    }
  }

  toBlock() {
    return {
      type: 'ipam_scope',
      id: `ipam_${this.scopeName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      scopeName: this.scopeName,
      subnets: JSON.parse(JSON.stringify(this.subnets))
    };
  }

  fromBlock(block = {}) {
    if (block.scopeName) this.scopeName = block.scopeName;
    if (Array.isArray(block.subnets)) {
      this.subnets = JSON.parse(JSON.stringify(block.subnets));
    }
  }
}
