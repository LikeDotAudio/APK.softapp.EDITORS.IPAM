// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { IpamModel } from './ipamModel.js';
import { BlockBridge } from './blockBridge.js';

export { IpamModel };

export class IpamApp {
  constructor() {
    this.model = new IpamModel();
    this.bridge = new BlockBridge({
      name: 'IPAM Manager',
      type: 'ipam_scope',
      onBlockLoaded: (b, m) => this.handleBlockLoaded(b, m),
      onBlockChanged: () => this.render()
    });

    this.tableBody = document.getElementById('subnet-table-body');
    this.svgContainer = document.getElementById('utilization-svg');
    this.initControls();
    this.render();
    this.autoConnect();
  }

  async autoConnect() {
    const discovered = await this.bridge.fetchDiscoveredProject();
    if (discovered && discovered.ipam && discovered.ipam.length > 0) {
      this.model.fromBlock(discovered.ipam[0]);
      this.render();
    }
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
        this.bridge.saveBlock(this.model.toBlock(), { name: this.model.scopeName });
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
      btnClose.addEventListener('click', () => this.bridge.close());
    }

    const btnDiscovered = document.getElementById('btn-discovered');
    if (btnDiscovered) {
      btnDiscovered.addEventListener('click', async () => {
        const disc = await this.bridge.fetchDiscoveredProject();
        if (disc && disc.ipam && disc.ipam.length > 0) {
          this.model.fromBlock(disc.ipam[0]);
          this.render();
        } else {
          alert('No IPAM scopes found in current discovered project.');
        }
      });
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
        this.bridge.notifyChanged();
      });
    }

    const propScope = document.getElementById('prop-scopeName');
    if (propScope) {
      propScope.addEventListener('input', (e) => {
        this.model.scopeName = e.target.value;
        this.bridge.notifyChanged();
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

  renderTable() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '';

    this.model.subnets.forEach((sub, idx) => {
      const tr = document.createElement('tr');
      const pct = sub.total > 0 ? Math.round((sub.allocated / sub.total) * 100) : 0;

      tr.innerHTML = `
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="cidr">${sub.cidr}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="vlan">${sub.vlan}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="name">${sub.name}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="gateway">${sub.gateway}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="allocated">${sub.allocated}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="total">${sub.total}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 8px; background: #080C16; border-radius: 4px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: ${pct > 85 ? '#EF4444' : (pct > 60 ? '#F4902C' : '#4ADE80')};"></div>
            </div>
            <span style="font-size: 11px; color: var(--text-muted); width: 32px;">${pct}%</span>
          </div>
        </td>
        <td style="text-align: center;">
          <button class="btn-delete" data-idx="${idx}" title="Delete Subnet">✕</button>
        </td>
      `;

      this.tableBody.appendChild(tr);
    });

    this.tableBody.querySelectorAll('[contenteditable=true]').forEach(cell => {
      cell.addEventListener('blur', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        this.model.updateSubnet(idx, field, e.target.innerText.trim());
        this.render();
        this.bridge.notifyChanged();
      });
    });

    this.tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.removeSubnet(idx);
        this.render();
        this.bridge.notifyChanged();
      });
    });
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
        <text x="25" y="${y + 14}" fill="#F0F4F8" font-size="11" font-family="JetBrains Mono, monospace">${sub.cidr}</text>
        <rect x="145" y="${y + 2}" width="42" height="16" rx="3" fill="#1E2A45"/>
        <text x="166" y="${y + 14}" fill="#4A9EFF" font-size="9" font-family="sans-serif" text-anchor="middle">VLAN ${sub.vlan}</text>

        <!-- Capacity Bar Track -->
        <rect x="200" y="${y + 4}" width="300" height="12" rx="3" fill="#080C16" stroke="#1E2A45" stroke-width="1"/>
        <rect x="200" y="${y + 4}" width="${barW}" height="12" rx="3" fill="${barColor}"/>

        <!-- Numbers -->
        <text x="515" y="${y + 14}" fill="#8B9BB4" font-size="10" font-family="sans-serif">${sub.allocated}/${sub.total} (${Math.round(pct * 100)}%)</text>
      `;
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${width}" height="${height}" fill="#080C16" rx="8"/>
        <text x="25" y="20" fill="#8B9BB4" font-size="10" font-family="sans-serif" text-transform="uppercase">Subnet CIDR Scope</text>
        <text x="200" y="20" fill="#8B9BB4" font-size="10" font-family="sans-serif" text-transform="uppercase">IP Allocation Distribution</text>
        <line x1="20" y1="24" x2="620" y2="24" stroke="#1E2A45" stroke-width="1"/>
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
