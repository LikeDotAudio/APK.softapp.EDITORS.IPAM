// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { IpamModel } from './ipamModel.js';
import { sightings, subnetFor, inCidr } from './ipamDiscovered.js';
import { loadSystems, saveSubnets, systemsToSubnets, exportSiteIfc, saveWithSiteTwin, scopeOf } from './ipamBench.js';

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
    window.APKSoftapp.describe({
      name: 'IPAM Manager',
      does: 'Plans subnets and VLANs for one IPAM scope and holds them against the addresses the bus has actually seen.',
      inputs: [
        { name: 'IPAM scope block', from: 'the CAD block this editor was opened on (host@1 load)', kind: 'cad' },
        { name: 'Block file', from: '.json picked with Open Block', kind: 'file' },
        { name: 'Discovered addresses', from: 'APKSoftapp.discovered(): scanners, agents and presence on the bus', kind: 'bus' },
        { name: 'Which things to show', from: 'config/discovery.json (kinds, countStates, suggestPrefix)', kind: 'file' },
        { name: 'The bench plan', from: 'DATABASE.server.BIM GET /api/bim/bench/systems on ⇩ From bench (each row with its IfcGlobalId)' },
      ],
      outputs: [
        { name: 'IPAM scope block', to: 'the CAD drawing on Save & Return (after the rows are planned on the bench); standalone, <id>.json beside its .ifc twin, the bench\'s site model (Save Model): {scopeName, systems: [bench ids]}, no copy of the plan', kind: 'cad' },
        { name: 'Live edits', to: 'the CAD after every change (blockChanged)', kind: 'cad' },
        { name: 'The bench plan', to: 'DATABASE.server.BIM bench systems on ⇧ To bench: VLANs and subnets in the site IFC model' },
        { name: 'Site model', to: 'a site.ifc download on ⬇ Export IFC (GET /api/bim/site.ifc)', kind: 'file' },
      ],
      controls: [
        { name: '+ Add Subnet', how: 'adds the next 192.168.x.0/24 with its VLAN and gateway' },
        { name: 'Subnet table', how: 'edit CIDR, VLAN, purpose, gateway, used, total; the row × deletes it' },
        { name: 'Plan subnet', how: 'on a discovered address no subnet holds: adds the subnet that would hold it' },
        { name: '⚡ Discovered', how: 'show / hide the On the network table' },
        { name: 'IPAM Scope Name', how: 'the scope name saved in the block' },
        { name: 'Save & Return / ✕', how: 'plan the rows on the bench, then save the block (their bench ids) into the CAD (or download) / close the editor' },
        { name: '⇩ From bench / ⇧ To bench', how: 'read the planned VLANs and subnets from the BIM bench / plan these there' },
        { name: '⬇ Export IFC', how: 'download the site model (site.ifc): the plan, the devices and their cables' },
      ],
      problems: ['bad_json', 'bad_input', 'file_unreadable', 'bus_missing', 'http_not_found', 'not_in_cad', 'http_forbidden', 'http_server_error', 'save_failed'],
    });
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
      const cfg = await window.APKSoftapp.discoveredConfig(new URL('../config/discovery.json', import.meta.url), { required: true });
      if (cfg.problem) throw Object.assign(new Error(cfg.why), { problem: cfg.problem });
      this.rules = cfg;
    } catch (err) {
      if (status) { status.setAttribute('data-apk-state', 'dead'); status.textContent = `Could not read config/discovery.json (${err.message}).`; }
      window.APKSoftapp.showProblem(err.problem || err, {
        subject: 'config/discovery.json',
        fix: ['config/discovery.json sits beside index.html in EDITORS.IPAM; it says which bus things are shown.'],
        onRetry: () => this.startDiscovered(),
      });
      return;
    }
    this.network = await window.APKSoftapp.discoveredPanel(host, {
      status, id: 'ipam-discovered', config: this.rules,
      empty: 'No addresses on the bus yet.',
      columns: [...window.APKSoftapp.DISCOVERED_COLUMNS.slice(0, 4), { key: 'subnet', label: 'In subnet', editable: false, mono: true }, window.APKSoftapp.DISCOVERED_COLUMNS[5]],
      toRows: (things) => things.filter((t) => t.ips && t.ips.length).map((t) => ({ ...window.APKSoftapp.thingRow(t), subnet: this.subnetOf(t) })),
      pickLabel: 'Plan subnet', onPick: (t) => this.planSubnet(t),
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

  /** ⇩ From bench: the bench's planned subnets replace the table (counts kept by CIDR). */
  async fromBench() {
    try {
      const items = await loadSystems();
      this.model.subnets = systemsToSubnets(items, this.model.subnets);
      this.owned = this.model.subnets.map((r) => r.id);
      this.model.legacy = false;
      this.render();
      this.changed();
      return this.model.subnets;
    } catch (err) {
      window.APKSoftapp.showProblem(err, { subject: 'the bench plan', fix: ['The plan is the BIM bench (DATABASE.server.BIM, /api/bim): check it is running in DockTor.'], onRetry: () => this.fromBench() });
      return null;
    }
  }

  /** The rows a block names, read from the bench (a block keeps only ids, ROAD-3582). */
  async loadScope() {
    const ids = this.model.systems || [];
    try {
      const { items, missing } = scopeOf(await loadSystems(), ids);
      this.model.subnets = systemsToSubnets(items, this.model.subnets);
      this.owned = this.model.subnets.map((r) => r.id);
      this.render();
      if (missing.length) {
        window.APKSoftapp.showProblem('http_not_found', {
          subject: 'the bench plan', detail: `This block names ${missing.join(', ')}, which the bench does not hold.`,
          fix: ['Someone removed them from the bench plan; add the subnets again and Save & Return, or ⇩ From bench for the whole plan.'],
        });
      }
      return this.model.subnets;
    } catch (err) {
      window.APKSoftapp.showProblem(err, { subject: 'the bench plan', detail: `This block names ${ids.join(', ') || 'no systems'} on the BIM bench.`, fix: ['The plan is the BIM bench (DATABASE.server.BIM, /api/bim): check it is running in DockTor.'], onRetry: () => this.loadScope() });
      return null;
    }
  }

  /** ⇧ To bench: these subnets and their VLANs become the bench's plan (and so its IFC model).
      Only subnets this block planned when it was loaded are ever removed (`owned`). */
  async toBench() {
    try {
      const items = await saveSubnets(this.model.subnets, { owned: this.owned || [] });
      const cidrs = new Set(this.model.subnets.map((r) => r.cidr));
      const planned = items.filter((r) => r.kind === 'subnet' && cidrs.has(r.cidr)).map((r) => r.id);
      this.model.subnets = systemsToSubnets(scopeOf(items, planned).items, this.model.subnets);
      this.owned = this.model.subnets.map((r) => r.id);
      this.model.legacy = false;
      this.render();
      return items;
    } catch (err) {
      window.APKSoftapp.showProblem(err, { subject: 'plan on the bench', fix: ['Each row needs a VLAN 1..4094, a CIDR network and a gateway inside it.'], onRetry: () => this.toBench() });
      return null;
    }
  }

  /** ⬇ Export IFC: the site model as an .ifc download (no IFC parser in the page). */
  async exportIfc() {
    try {
      const text = await exportSiteIfc();
      const url = URL.createObjectURL(new Blob([text], { type: 'model/step' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'site.ifc' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return text;
    } catch (err) {
      window.APKSoftapp.showProblem(err, { subject: 'site.ifc', onRetry: () => this.exportIfc() });
      return null;
    }
  }

  /** A block names bench ids (read them from the bench); an old one carries its rows (kept as they are
      until Save & Return moves them onto the bench). */
  handleBlockLoaded(block, meta) {
    if (!block) return;
    this.model.fromBlock(block);
    this.owned = [];
    this.render();
    if (this.model.systems) this.loadScope();
  }

  /** Save & Return: the rows go onto the bench first, then the block — their ids — into the CAD; standalone,
      the block and its .ifc twin, the bench's site model (Save Model). */
  async saveBlock() {
    if (!(await this.toBench())) return null;
    const block = this.model.toBlock();
    await saveWithSiteTwin(window.APKSoftapp, this.host, block, { name: this.model.scopeName, filename: block.id }, { onRetry: () => this.saveBlock() });
    return block;
  }

  initControls() {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => this.saveBlock());
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
              this.handleBlockLoaded(data);
              this.changed();
            } catch (err) {
              window.APKSoftapp.showProblem(err.name === 'SyntaxError' ? 'bad_json' : 'bad_input', {
                subject: file.name, detail: err.message,
                fix: ['Open an IPAM scope block (.json saved by this editor, blockType ipam_scope: {scopeName, systems} or an old one with subnets).'],
              });
            }
          };
          reader.onerror = () => window.APKSoftapp.showProblem('file_unreadable', { subject: file.name, detail: reader.error && reader.error.message });
          reader.readAsText(file);
        };
        input.click();
      });
    }

    document.getElementById('btn-from-bench')?.addEventListener('click', () => this.fromBench());
    document.getElementById('btn-to-bench')?.addEventListener('click', () => this.toBench());
    document.getElementById('btn-export-ifc')?.addEventListener('click', () => this.exportIfc());

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
