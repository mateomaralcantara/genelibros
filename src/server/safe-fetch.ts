import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * fetch() para URLs aportadas por usuarios (protección SSRF).
 *  - Solo http/https en puertos estándar.
 *  - Rechaza hosts que resuelven a IPs privadas, loopback, link-local o metadata cloud.
 *  - Sigue redirecciones manualmente validando cada salto.
 *  - Timeout y límite de tamaño de respuesta.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2_000_000;

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (isIP(lower) === 4) return isPrivateIPv4(lower);
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff")
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Solo se permiten URLs http/https.");
  if (url.username || url.password) throw new Error("URL con credenciales no permitida.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Puerto no permitido.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Host no permitido.");
  }

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Host no permitido.");
  }
  return url;
}

export async function safeFetchText(
  raw: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ status: number; ok: boolean; text: string; url: string }> {
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let current = raw;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const url = await assertPublicUrl(current);
      const response = await fetch(url, {
        method: "GET",
        headers: init.headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Redirección sin destino.");
        current = new URL(location, url).toString();
        continue;
      }

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      return { status: response.status, ok: response.ok, text, url: url.toString() };
    }
    throw new Error("Demasiadas redirecciones.");
  } finally {
    clearTimeout(timer);
  }
}
