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
   IfcGlobalId (guid), so a pick in an IFC viewer maps back.

   THE CAD BLOCK KEEPS ONLY IDS (ROAD-3582). An ipam_scope block is
   {type, id, scopeName, systems: [ids]} — the bench systems it plans, never
   a private subnets[] copy (contracts BimSystemsRefSchema). An old block that
   still carries subnets[] stays readable (readBlock): its rows load as they
   were, and Save & Return moves them onto the bench, leaving only the ids. */

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

export const subnetId = (cidr) => `S-${String(cidr).replace(/[^0-9A-Za-z]+/g, '-').replace(/-+$/, '')}`;

/** The bench ids a set of subnet rows plans: each subnet and its VLAN (VLANs first), once each. */
export function systemIdsOf(subnets = []) {
  const vlans = [];
  const nets = [];
  for (const sub of subnets) {
    const v = sub.vlanSystem || (Number(sub.vlan) >= 1 ? `V${Number(sub.vlan)}` : null);
    if (v && !vlans.includes(v)) vlans.push(v);
    const n = sub.id || subnetId(sub.cidr);
    if (!nets.includes(n)) nets.push(n);
  }
  return [...vlans, ...nets];
}

/** An ipam_scope block, either shape: {scopeName, systems} (ids, today) or {scopeName, subnets} (an old block). */
export function readBlock(block = {}) {
  const out = { scopeName: typeof block.scopeName === 'string' && block.scopeName ? block.scopeName : null, systems: null, subnets: null };
  if (Array.isArray(block.systems)) out.systems = block.systems.filter(id => typeof id === 'string' && id);
  else if (Array.isArray(block.subnets)) out.subnets = JSON.parse(JSON.stringify(block.subnets));
  return out;
}

/** The bench rows a block's ids name: its subnets and the VLANs they sit in; `missing` = ids the bench lacks. */
export function scopeOf(items = [], ids = []) {
  const want = new Set(ids);
  const byId = new Map(items.map(s => [s.id, s]));
  const nets = items.filter(s => s.kind === 'subnet' && want.has(s.id));
  const vlans = new Set(nets.map(s => s.parent));
  for (const id of ids) if (byId.get(id)?.kind === 'vlan') vlans.add(id);
  return {
    items: items.filter(s => (s.kind === 'vlan' && vlans.has(s.id)) || nets.includes(s)),
    missing: ids.filter(id => !byId.has(id)),
  };
}

/** The bench's systems → the editor's subnet rows (a subnet whose VLAN is gone keeps vlan 0). */
export function systemsToSubnets(items, previous = []) {
  const vlans = new Map(items.filter(s => s.kind === 'vlan').map(s => [s.id, s]));
  const was = new Map(previous.map(s => [s.cidr, s]));
  return items.filter(s => s.kind === 'subnet').map(s => {
    const v = vlans.get(s.parent);
    const row = {
      cidr: s.cidr, vlan: v ? v.vlan_id : 0, name: s.name || v?.name || '', gateway: s.gateway || '',
      allocated: was.get(s.cidr)?.allocated ?? 0, total: hostsIn(s.cidr),
      guid: s.guid, vlanGuid: v?.guid, id: s.id, vlanSystem: v?.id,
    };
    return row;
  });
}

/** The editor's subnet rows → the PUTs that plan them on the bench, merged onto what the bench holds.
    `owned` (the ids this block planned when it was loaded) limits the DELETEs to this block's own
    subnets: a subnet another scope plans is never removed here. Without it, every bench subnet the
    rows do not hold is removed (the whole-plan view of ⇩ From bench). */
export function subnetsToSystems(subnets, existing = [], owned = null) {
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
  const mine = owned ? new Set(owned) : null;
  const gone = existing.filter(s => s.kind === 'subnet' && !keep.has(s.id) && (!mine || mine.has(s.id))).map(s => s.id);
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
export async function saveSubnets(subnets, { api = bimApi(), fetchImpl = globalThis.fetch, owned = null } = {}) {
  const existing = await loadSystems({ api, fetchImpl });
  const { puts, deletes } = subnetsToSystems(subnets, existing, owned);
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

/** Save & Return's last step: into the CAD; standalone, Save Model (ROAD-3583) — the block (.json) and its
    .ifc twin, the bench's site model (GET /api/bim/site.ifc: the plan the block's ids name), both or neither.
    → 'host' | 'download' | 'directory', or '' (the problem is on screen; a cancelled picker says nothing). */
export async function saveWithSiteTwin(S, host, block, meta, { api = bimApi(), fetchImpl = globalThis.fetch, onRetry } = {}) {
  if (host.embedded || typeof S.saveModel !== 'function') return host.save(block, meta);
  const r = await S.saveModel(block, { name: meta.filename, toIfc: () => exportSiteIfc({ api, fetchImpl }) });
  if (!r.ok && !r.cancelled) S.showProblem(r.problem || 'save_failed', { onRetry });
  return r.ok ? r.via : '';
}
