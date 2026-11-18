import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export function isPublicIp(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return (
      /^[23][0-9a-f]/.test(v) &&
      !v.startsWith("2001:db8") &&
      !v.startsWith("2001:0:")
    );
  }
  return false;
}
export function safeWebUrl(raw: string) {
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw new Error("URL externa inválida");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".example") ||
    host.endsWith(".invalid")
  )
    throw new Error("Host privado");
  if (isIP(host) && !isPublicIp(host)) throw new Error("IP privado");
  return u;
}
export async function fetchPublicHtml(
  raw: string,
  redirects = 0,
): Promise<{ html: string; url: string }> {
  if (redirects > 3) throw new Error("Redirecionamentos excedidos");
  const url = safeWebUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address)))
    throw new Error("DNS não público");
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        timeout: 4000,
        maxHeaderSize: 16384,
        headers: {
          "user-agent": "VerificaAI/1.0 (+https://verifica7.vercel.app/)",
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
        },
        lookup: (_host, _opts, cb) => cb(null, pinned.address, pinned.family),
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          fetchPublicHtml(
            new URL(res.headers.location, url).toString(),
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (
          status !== 200 ||
          !String(res.headers["content-type"] || "")
            .toLowerCase()
            .includes("text/html")
        ) {
          res.resume();
          reject(new Error("Site indisponível ou não HTML"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 650_000) {
            req.destroy(new Error("HTML acima do limite"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            html: Buffer.concat(chunks).toString("utf8"),
            url: url.toString(),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado")));
    req.on("error", reject);
    req.end();
  });
}
