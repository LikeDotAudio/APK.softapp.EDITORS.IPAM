// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* THE PLAN ON THE BENCH (IFC-CORE-DELTAS network-discovery-3/7).

   The site's planned VLANs and subnets live once, in the BIM bench document
   (DATABASE.server.BIM bim/network.py): GET /api/bim/bench/systems, PUT / DELETE
   /api/bim/bench/systems/<id>. The bench's .ifc twin carries them as IFC4X3
   (a VLAN is an IfcDistributionSystem DATA 'VLAN', a subnet a nested 'SUBNET'),
   so ⇩ From bench / ⇧ To bench here is the same plan the IFC model and NetBox see.

     subnet row {cidr, vlan, name, gateway}  <->  {kind:'vlan', vlan_id, name}
                                                  + {kind:'subnet', parent, cidr, gateway, name}

   A VLAN the Switch or MoIP editor also uses keeps its members, DSCP and
   profile: To bench only names a VLAN, never empties it. allocated / total
   are counts, derived here, never stored. Every row read back keeps its
   IfcGlobalId (guid), so a pick in an IFC viewer maps back. */

export function bimApi() {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search || '').get('bim');
    if (fromUrl) return fromUrl.replace(/\/$/, '');
  } catch (_) { /* no location under node */ }
  return (globalThis.APK_BIM_API || '/api/bim').replace(/\/$/, '');
}

/** Addresses in a v4 prefix the hosts can use (a /31 and /32 count as is). */
export function hostsIn(cidr) {
  const bits = Number(String(cidr).split('/')[1]);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return 0;
  const n = 2 ** (32 - bits);
  return bits >= 31 ? n : n - 2;
}

const subnetId = (cidr) => `S-${String(cidr).replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/, '')}`;

/** The bench's systems → the editor's subnet rows (a subnet whose VLAN is gone keeps vlan 0). */
export function systemsToSubnets(items, previous = []) {
  const vlans = new Map(items.filter(s => s.kind === 'vlan').map(s => [s.id, s]));
  const was = new Map(previous.map(s => [s.cidr, s]));
  return items.filter(s => s.kind === 'subnet').map(s => {
    const v = vlans.get(s.parent);
    const row = {
      cidr: s.cidr, vlan: v ? v.vlan_id : 0, name: s.name || v?.name || '', gateway: s.gateway || '',
      allocated: was.get(s.cidr)?.allocated ?? 0, total: hostsIn(s.cidr),
      guid: s.guid, vlanGuid: v?.guid, id: s.id,
    };
    return row;
  });
}

/** The editor's subnet rows → the PUTs that plan them on the bench, merged onto what the bench holds. */
export function subnetsToSystems(subnets, existing = []) {
  const byVid = new Map(existing.filter(s => s.kind === 'vlan').map(s => [s.vlan_id, s]));
  const byCidr = new Map(existing.filter(s => s.kind === 'subnet').map(s => [s.cidr, s]));
  const vlans = new Map();
  const nets = [];
  for (const sub of subnets) {
    const vid = Number(sub.vlan);
    if (!Number.isInteger(vid) || vid < 1 || vid > 4094) throw Object.assign(new Error(`VLAN ${sub.vlan} of ${sub.cidr} is not 1..4094`), { code: 'bad_input' });
    if (!vlans.has(vid)) {
      const old = byVid.get(vid);
      const { guid, ...keep } = old || {};
      vlans.set(vid, { ...keep, id: old?.id || `V${vid}`, kind: 'vlan', vlan_id: vid, name: sub.name || old?.name || `VLAN ${vid}` });
    }
    const old = byCidr.get(sub.cidr);
    const row = { id: old?.id || subnetId(sub.cidr), kind: 'subnet', parent: vlans.get(vid).id, cidr: sub.cidr, name: sub.name || undefined };
    if (sub.gateway) row.gateway = sub.gateway;
    if (old?.dns) row.dns = old.dns;
    if (old?.dhcp_start) row.dhcp_start = old.dhcp_start;
    if (old?.dhcp_end) row.dhcp_end = old.dhcp_end;
    nets.push(JSON.parse(JSON.stringify(row)));
  }
  const keep = new Set(nets.map(n => n.id));
  const gone = existing.filter(s => s.kind === 'subnet' && !keep.has(s.id)).map(s => s.id);
  return { puts: [...vlans.values(), ...nets], deletes: gone };
}

async function answer(res, what) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${what}: ${body.error || res.status}`);
    err.status = res.status;
    err.code = res.status === 401 || res.status === 403 ? 'http_forbidden' : res.status === 404 ? 'http_not_found'
      : res.status >= 500 ? 'http_server_error' : 'bad_input';
    throw err;
  }
  return body;
}

export async function loadSystems({ api = bimApi(), fetchImpl = globalThis.fetch } = {}) {
  return (await answer(await fetchImpl(`${api}/bench/systems`), 'read the bench plan')).items || [];
}

/** Write the subnets as the bench's plan: VLANs first (a subnet names one), then subnets, then the removed ones. */
export async function saveSubnets(subnets, { api = bimApi(), fetchImpl = globalThis.fetch } = {}) {
  const existing = await loadSystems({ api, fetchImpl });
  const { puts, deletes } = subnetsToSystems(subnets, existing);
  for (const row of puts) {
    const { id, ...body } = row;
    await answer(await fetchImpl(`${api}/bench/systems/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), `plan ${id}`);
  }
  for (const id of deletes) {
    await answer(await fetchImpl(`${api}/bench/systems/${encodeURIComponent(id)}`, { method: 'DELETE' }), `remove ${id}`);
  }
  return loadSystems({ api, fetchImpl });
}

/** The site model as IFC4X3 (GET /api/bim/site.ifc) — the plan, the devices and their cables. */
export async function exportSiteIfc({ api = bimApi(), fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${api}/site.ifc`);
  if (!res.ok) throw Object.assign(new Error(`site.ifc: ${res.status}`), { status: res.status, code: res.status === 404 ? 'http_not_found' : 'http_server_error' });
  return res.text();
}
