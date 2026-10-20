import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";

/**
 * Fetch for agent probes. The model chooses the URLs, so this guards against
 * SSRF: http(s) only, public addresses only (checked at connect time, so DNS
 * rebinding can't swap the address after the check), no redirects followed, no
 * credentials, small bodies, short timeouts.
 */

export class BlockedUrlError extends Error {}

const blocked = new BlockList();
for (const [base, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(base, bits, "ipv4");
}
for (const [base, bits] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96], // IPv4-compatible
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(base, bits, "ipv6");
}

/** BlockList also matches IPv4-mapped IPv6 (::ffff:7f00:1) against the IPv4 rules. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError(`not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedUrlError(`only http(s) URLs can be probed, got ${url.protocol}`);
  }
  if (url.username || url.password) throw new BlockedUrlError("URLs with credentials are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new BlockedUrlError(`host not allowed: ${host}`);
  }
  if (isIP(host)) {
    // IP literals skip DNS (and the connect-time lookup), so check them here.
    if (isPrivateAddress(host)) throw new BlockedUrlError(`address not allowed: ${host}`);
  } else if (!host.includes(".")) {
    throw new BlockedUrlError(`host not allowed: ${host}`);
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup used for the actual connection: every resolved address must be public. */
export function publicOnlyLookup(hostname: string, options: LookupOptions, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new BlockedUrlError(`host resolves to a non-public address: ${hostname}`) as NodeJS.ErrnoException, []);
    }
    if (options.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

const agent = new Agent({ connect: { lookup: publicOnlyLookup, timeout: 8000 } });

export interface ProbeResponse {
  status: number;
  location: string;
  contentType: string;
  body: string;
  elapsedMs: number;
}

export async function probeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<ProbeResponse> {
  const url = await assertPublicUrl(raw);
  const started = Date.now();
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      dispatcher: agent,
      headers: {
        "user-agent": "GreenlightProbe/1.0 (OAuth readiness research; read-only)",
        accept: "application/json, text/html;q=0.9, */*;q=0.5",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
  } catch (err) {
    // undici wraps connection errors; surface our own block reason.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof BlockedUrlError) throw cause;
    throw err;
  }
  const reader = res.body?.getReader();
  const maxBytes = opts.maxBytes ?? 60_000;
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => {});
  }
  const body = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    contentType: res.headers.get("content-type") ?? "",
    body,
    elapsedMs: Date.now() - started,
  };
}
