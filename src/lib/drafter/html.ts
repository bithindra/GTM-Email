// Minimal HTML helpers for reading a page's head — enough for titles, meta tags and a
// heading or two. Deliberately no parser dependency: we only ever read a handful of
// well-known tags, and the output is shown to the user for review before any use.

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™",
};

export function decodeEntities(s: string): string {
  return (s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Text of an element's inner HTML: tags removed, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  return decodeEntities(
    (html || "")
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

/** content="" of <meta name|property="key">, attribute order-independent. */
export function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const want = key.toLowerCase();
  for (const tag of tags) {
    const attr = (n: string) => tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    const k = attr("property") || attr("name");
    if (!k || (k[2] ?? k[3] ?? "").toLowerCase() !== want) continue;
    const c = attr("content");
    if (c) return decodeEntities(c[2] ?? c[3] ?? "").replace(/\s+/g, " ").trim();
  }
  return "";
}
