// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { IpamModel } from './ipamModel.js';
import { sightings, subnetFor, inCidr } from './ipamDiscovered.js';
import { mountDiscovered, loadRules, thingRow, THING_COLUMNS } from './discoveredTable.js';

const esc = (s) => window.APKSoftapp.esc(s);

export { IpamModel };

export class IpamApp {
  constructor() {
    this.model = new IpamModel();
    /* The CAD link: cad.like.audio/host@1 through vendor/apk-softapp. Same
       origin only; standalone, Save downloads the block as .json. */
    this.host = window.APKSoftapp.connectHost({
      editor: 'IPAM Manager',
      blockType: 'ipam_scope',
      onLoad: (b, m) => this.handleBlockLoaded(b, m),
      onRequest: () => ({ block: this.model.toBlock(), meta: { name: this.model.scopeName } }),
    });

    this.things = [];
    this.tableHost = document.getElementById('subnet-table');
    this.svgContainer = document.getElementById('utilization-svg');
    this.initControls();
    this.render();
    this.startDiscovered();
  }

  changed() {
    this.host.changed(this.model.toBlock());
  }

  /* Every address the bus has seen (which things: config/discovery.json),
     held against the subnets: "On bus" per subnet, and the ones no subnet holds. */
  async startDiscovered() {
    const host = document.getElementById('net-table');
    const status = document.getElementById('net-status');
    if (!host) return;
    try {
      this.rules = await loadRules(import.meta.url);
    } catch (err) {
      if (status) { status.setAttribute('data-apk-state', 'dead'); status.textContent = `Could not read config/discovery.json (${err.message}).`; }
      return;
    }
    this.network = await mountDiscovered({
      host, status, id: 'ipam-discovered', kinds: this.rules.kinds,
      empty: 'No addresses on the bus yet.',
      columns: [...THING_COLUMNS.slice(0, 4), { key: 'subnet', label: 'In subnet', editable: false, mono: true }, THING_COLUMNS[5]],
      toRows: (things) => things.filter((t) => t.ips && t.ips.length).map((t) => ({ ...thingRow(t), subnet: this.subnetOf(t) })),
      action: { label: 'Plan subnet', run: (t) => this.planSubnet(t) },
      onChange: (things) => { this.things = things; this.renderTable(); this.renderSvg(); },
    });
  }

  subnetOf(t) {
    const s = this.model.subnets.find((sub) => t.ips.some((ip) => inCidr(ip, sub.cidr)));
    if (s) return s.cidr;
    const u = sightings(this.model.subnets, [t], this.rules || {}).unplaced[0];
    return u ? `none (${u.cidr}?)` : 'none';
  }

  planSubnet(t) {
    const { unplaced } = sightings(this.model.subnets, this.things, this.rules || {});
    const mine = unplaced.find((u) => u.thing.id === t.id);
    if (!mine) return;
    this.model.subnets.push(subnetFor(mine.cidr, unplaced.filter((u) => u.cidr === mine.cidr).length));
    this.render();
    this.changed();
  }

  handleBlockLoaded(block, meta) {
    if (block) {
      this.model.fromBlock(block);
      this.render();
    }
  }

  initControls() {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.host.save(this.model.toBlock(), { name: this.model.scopeName, filename: this.model.toBlock().id });
      });
    }

    const btnOpen = document.getElementById('btn-open');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              this.model.fromBlock(data);
              this.render();
              this.changed();
            } catch (err) {
              alert('Invalid block file: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }

    const btnClose = document.getElementById('btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.host.close());
    }

    const btnDiscovered = document.getElementById('btn-discovered');
    if (btnDiscovered) {
      btnDiscovered.addEventListener('click', () => document.body.classList.toggle('net-hidden'));
    }

    const btnAddSubnet = document.getElementById('btn-add-subnet');
    if (btnAddSubnet) {
      btnAddSubnet.addEventListener('click', () => {
        this.model.addSubnet({
          cidr: `192.168.${this.model.subnets.length + 10}.0/24`,
          vlan: this.model.subnets.length + 10,
          name: 'New Audio Subnet',
          gateway: `192.168.${this.model.subnets.length + 10}.1`,
          allocated: 12,
          total: 254
        });
        this.render();
        this.changed();
      });
    }

    const propScope = document.getElementById('prop-scopeName');
    if (propScope) {
      propScope.addEventListener('input', (e) => {
        this.model.scopeName = e.target.value;
        this.changed();
      });
    }
  }

  render() {
    const propScope = document.getElementById('prop-scopeName');
    if (propScope) {
      propScope.value = this.model.scopeName;
    }

    this.renderTelemetry();
    this.renderTable();
    this.renderSvg();
  }

  renderTelemetry() {
    const totalAlloc = this.model.subnets.reduce((sum, s) => sum + s.allocated, 0);
    const totalCap = this.model.subnets.reduce((sum, s) => sum + s.total, 0);
    const pct = totalCap > 0 ? Math.round((totalAlloc / totalCap) * 100) : 0;

    const badge = document.getElementById('telemetry-badge');
    if (badge) {
      badge.textContent = `${totalAlloc} / ${totalCap} IPs In Use (${pct}% Allocated Across ${this.model.subnets.length} Subnets)`;
      badge.style.color = pct > 80 ? '#F4902C' : '#4ADE80';
    }
  }

  /* The subnet schedule is an APKTable (vendor/apk-table): APKTable.get('ipam-subnets').
     "On bus" is what the bus sees in use there now, never stored in the block. */
  renderTable() {
    if (!this.tableHost || !window.APKTable) return;
    const seen = sightings(this.model.subnets, this.things, this.rules || {}).per;
    const rows = this.model.subnets.map((sub, i) => ({
      ...sub,
      onBus: this.network && this.network.ok ? `${seen[i].seen}${seen[i].dead ? ` (+${seen[i].dead} dead)` : ''}` : '',
    }));
    if (this.table) { this.table.setRows(rows); return; }
    this.table = window.APKTable.create(this.tableHost, {
      id: 'ipam-subnets',
      searchPlaceholder: 'Filter subnets',
      empty: 'No subnets. Add one, or plan one from an address on the network.',
      columns: [
        { key: 'cidr', label: 'CIDR Subnet', mono: true },
        { key: 'vlan', label: 'VLAN', type: 'number' },
        { key: 'name', label: 'Network Purpose' },
        { key: 'gateway', label: 'Default Gateway', mono: true },
        { key: 'allocated', label: 'Used', type: 'number' },
        { key: 'total', label: 'Total', type: 'number' },
        { key: 'onBus', label: 'On bus', editable: false },
        { key: 'capacity', label: 'Capacity', render: (v, row) => this.capacityBar(row) },
      ],
      rows,
      onEdit: (i, key, value) => {
        this.model.updateSubnet(i, key, value);
        this.render();
        this.changed();
      },
      onDelete: (i) => {
        this.model.removeSubnet(i);
        this.render();
        this.changed();
      },
    });
  }

  capacityBar(sub) {
    const pct = sub.total > 0 ? Math.round((sub.allocated / sub.total) * 100) : 0;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; align-items:center; gap:8px;';
    const track = document.createElement('div');
    track.style.cssText = 'flex:1; height:8px; background:#121212; border-radius:4px; overflow:hidden; min-width:60px;';
    const fill = document.createElement('div');
    fill.style.cssText = `width:${Math.min(100, Math.max(0, pct))}%; height:100%; background:${pct > 85 ? '#EF4444' : (pct > 60 ? '#F4902C' : '#4ADE80')};`;
    track.appendChild(fill);
    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px; color:var(--text-muted); width:32px;';
    label.textContent = `${pct}%`;
    wrap.append(track, label);
    return wrap;
  }

  renderSvg() {
    if (!this.svgContainer) return;

    const width = 640;
    const rowH = 28;
    const height = Math.max(160, this.model.subnets.length * rowH + 40);

    let rowsSvg = '';
    this.model.subnets.forEach((sub, i) => {
      const y = 30 + i * rowH;
      const pct = sub.total > 0 ? (sub.allocated / sub.total) : 0;
      const barW = Math.round(pct * 300);
      const barColor = pct > 0.85 ? '#EF4444' : (pct > 0.60 ? '#F4902C' : '#4ADE80');

      rowsSvg += `
        <!-- Subnet Name & VLAN -->
        <text x="25" y="${y + 14}" fill="#f4f4f5" font-size="11" font-family="JetBrains Mono, monospace">${esc(sub.cidr)}</text>
        <rect x="145" y="${y + 2}" width="42" height="16" rx="3" fill="#2c2c2c"/>
        <text x="166" y="${y + 14}" fill="#4A9EFF" font-size="9" font-family="sans-serif" text-anchor="middle">VLAN ${esc(sub.vlan)}</text>

        <!-- Capacity Bar Track -->
        <rect x="200" y="${y + 4}" width="300" height="12" rx="3" fill="#121212" stroke="#2c2c2c" stroke-width="1"/>
        <rect x="200" y="${y + 4}" width="${barW}" height="12" rx="3" fill="${barColor}"/>

        <!-- Numbers -->
        <text x="515" y="${y + 14}" fill="#888888" font-size="10" font-family="sans-serif">${esc(sub.allocated)}/${esc(sub.total)} (${Math.round(pct * 100)}%)</text>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#121212" rx="8"/>
        <text x="25" y="20" fill="#888888" font-size="10" font-family="sans-serif" text-transform="uppercase">Subnet CIDR Scope</text>
        <text x="200" y="20" fill="#888888" font-size="10" font-family="sans-serif" text-transform="uppercase">IP Allocation Distribution</text>
        <line x1="20" y1="24" x2="620" y2="24" stroke="#2c2c2c" stroke-width="1"/>
        ${rowsSvg}
      </svg>
    `;

    this.svgContainer.innerHTML = svg;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new IpamApp();
  });
}
