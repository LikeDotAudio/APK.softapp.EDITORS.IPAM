// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* ipamDiscovered.js — the addresses the bus has seen, held against the plan.

   Pure: subnets (the ipam_scope block) and things from APKSoftapp.discovered()
   in, sightings out. A thing is counted once per subnet by its identity (MAC,
   else serial, else agent — never by its address), so one NIC answering two
   protocols is one address in use. A dead thing is not using its address. */

export function ipv4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

export function intToIpv4(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** { base, prefix } of '10.10.100.0/23', or null. */
export function parseCidr(cidr) {
  const [ip, len] = String(cidr || '').split('/');
  const base = ipv4ToInt(ip);
  const prefix = Number(len);
  if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { base: (base & mask) >>> 0, mask, prefix };
}

export function inCidr(ip, cidr) {
  const n = ipv4ToInt(ip);
  const c = parseCidr(cidr);
  return n !== null && !!c && ((n & c.mask) >>> 0) === c.base;
}

/** The usable host count of a prefix (a /31 and /32 are point links: 2 and 1). */
export function hostsIn(prefix) {
  if (prefix >= 31) return prefix === 31 ? 2 : 1;
  return 2 ** (32 - prefix) - 2;
}

const identity = (t) => t.mac || t.serial || (t.agent && t.agent.node) || t.id;

/**
 * Per subnet (same order): { seen, ids, dead } — `seen` the things in use there
 * (by identity, states in rules.countStates), `dead` the ones the bus lost.
 * And `unplaced`: things with an IPv4 no subnet holds, with the subnet that would.
 */
export function sightings(subnets, things, rules = {}) {
  const count = new Set(rules.countStates || ['good', 'kinda']);
  const prefix = rules.suggestPrefix || 24;
  const per = subnets.map(() => ({ seen: 0, dead: 0, ids: new Set() }));
  const unplaced = [];
  for (const t of things) {
    const state = (t.live && t.live.state) || 'kinda';
    const id = identity(t);
    let placed = false;
    for (const ip of t.ips || []) {
      subnets.forEach((s, i) => {
        if (!inCidr(ip, s.cidr)) return;
        placed = true;
        const p = per[i];
        if (p.ids.has(id)) return;
        p.ids.add(id);
        if (count.has(state)) p.seen += 1;
        else if (state === 'dead') p.dead += 1;
      });
    }
    if (!placed && (t.ips || []).some((ip) => ipv4ToInt(ip) !== null) && count.has(state)) {
      const ip = t.ips.find((x) => ipv4ToInt(x) !== null);
      unplaced.push({ thing: t, ip, cidr: suggestCidr(ip, prefix) });
    }
  }
  return { per: per.map((p) => ({ seen: p.seen, dead: p.dead, ids: [...p.ids] })), unplaced };
}

export function suggestCidr(ip, prefix = 24) {
  const n = ipv4ToInt(ip);
  if (n === null) return '';
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return `${intToIpv4((n & mask) >>> 0)}/${prefix}`;
}

/** A subnet for an address no subnet holds: gateway left empty (the bus does not say it). */
export function subnetFor(cidr, inUse) {
  const c = parseCidr(cidr);
  return { cidr, vlan: 0, name: 'Seen on the network', gateway: '', allocated: inUse, total: c ? hostsIn(c.prefix) : 0 };
}
