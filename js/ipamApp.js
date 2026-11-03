// Part of the APK.audio project — Anthony Kuzub
// MIT Licence.

export class IpamModel {
  constructor() {
    this.subnets = [
      { cidr: '10.10.10.0/24', vlan: 10, name: 'Dante Primary Audio', gateway: '10.10.10.1', allocated: 48, total: 254 },
      { cidr: '10.10.20.0/24', vlan: 20, name: 'Dante Secondary Audio', gateway: '10.10.20.1', allocated: 48, total: 254 },
      { cidr: '10.10.30.0/24', vlan: 30, name: 'AV Control & Mon', gateway: '10.10.30.1', allocated: 32, total: 254 },
      { cidr: '10.10.100.0/23', vlan: 100, name: 'SMPTE 2110 Video', gateway: '10.10.100.1', allocated: 120, total: 510 }
    ];
  }

  addSubnet(subnet) {
    this.subnets.push(subnet);
  }
}
