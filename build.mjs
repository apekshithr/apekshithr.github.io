// Zero-dependency static blog builder.
// Usage: node build.mjs          -> builds into ./dist
//        node build.mjs --serve  -> builds, serves on :4000 and rebuilds on change

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "dist");
const POSTS = path.join(ROOT, "posts");
const PAGES = path.join(ROOT, "pages");
const STATIC = path.join(ROOT, "static");

/* ---------------- helpers ---------------- */

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function parseFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const data = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  }
  return { data, body };
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = esc(s);
  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const ext = /^https?:/.test(href) ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${href}"${ext}>${t}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_]+)_(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/ -- /g, " — ")
    .replace(/(^|\s):-?\)(?=[\s.,!?]|$)/g, "$1🙂")
    .replace(/(^|\s):-?D(?=[\s.,!?]|$)/g, "$1😄")
    .replace(/(^|\s);-?\)(?=[\s.,!?]|$)/g, "$1😉")
    .replace(/(^|\s):-?\((?=[\s.,!?]|$)/g, "$1🙁");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// Small Markdown subset: headings, paragraphs, lists, quotes, code, images, rules.
function markdown(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    let h = line.match(/^(#{2,3})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push("<hr>"); i++; continue; }

    const img = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
    if (img) {
      const cap = img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : "";
      out.push(`<figure><img src="${img[2]}" alt="${esc(img[1])}" loading="lazy">${cap}</figure>`);
      i++; continue;
    }
    if (line.startsWith(">")) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(buf.join(" "))}</p></blockquote>`);
      continue;
    }
    if (/^([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const buf = [];
      while (i < lines.length && /^([-*]|\d+\.)\s/.test(lines[i]))
        buf.push(`<li>${inline(lines[i++].replace(/^([-*]|\d+\.)\s+/, ""))}</li>`);
      out.push(`<${ordered ? "ol" : "ul"}>${buf.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|```|[-*]\s|\d+\.\s)/.test(lines[i]))
      buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const fmtDate = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const readingTime = (text) => Math.max(1, Math.round(text.split(/\s+/).length / 230));

/* ---------------- layout ---------------- */

// Changes whenever style.css changes, so browsers never mix a new page with an old cached stylesheet.
const version = (file) => crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, "src", file))).digest("hex").slice(0, 8);

function layout(cfg, { title, description, body, path: p, active, type = "website", image, date, rail = "" }) {
  const url = cfg.url.replace(/\/$/, "") + p;
  const fullTitle = title ? `${title} — ${cfg.name}` : `${cfg.name} · ${cfg.title}`;
  const img = image ? (image.startsWith("http") ? image : cfg.url.replace(/\/$/, "") + image) : "";
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="${cfg.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#ffffff">
<meta name="color-scheme" content="light">
<link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/oswald-500-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="/feed.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css?v=${version("style.css")}">
<script src="/site.js?v=${version("site.js")}" defer></script>
<script>addEventListener("pagereveal", (e) => { if (e.viewTransition) document.documentElement.classList.add("vt"); });</script>
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:title" content="${esc(title || cfg.name)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
${img ? `<meta property="og:image" content="${img}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="627">\n<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
${date ? `<meta property="article:published_time" content="${date}">\n<meta name="author" content="${esc(cfg.name)}">` : ""}
</head>
<body class="${active === "home" ? "is-home" : "is-read"}">
<div class="shell">
  <a class="mark" href="/" aria-label="${esc(cfg.name)}, home">${esc(cfg.mark || cfg.name)}</a>
  <nav class="nav" aria-label="Site">
    <a href="/about/"${active === "about" ? ' aria-current="page"' : ""}>About</a>
    <a href="${cfg.linkedin}" target="_blank" rel="noopener">LinkedIn</a>
    <a href="/feed.xml">RSS</a>
    <button class="sound" type="button" aria-pressed="true" hidden>Sound</button>
  </nav>
${rail}
  <main class="main" id="main">
${body}
  </main>
</div>
</body>
</html>
`;
}

/* ---------------- build ---------------- */

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/* ---------------- LinkedIn share cards (1200×627) ---------------- */

const CHROME = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((c) => c && fs.existsSync(c));

function cardHtml(cfg, title, kicker) {
  const font = (f) => `file://${path.join(STATIC, "fonts", f)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:400 600;src:url("${font("inter-latin.woff2")}")}
@font-face{font-family:Oswald;font-weight:500;src:url("${font("oswald-500-latin.woff2")}")}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:627px;background:#fff;color:#111;overflow:hidden}
body{font-family:Inter,sans-serif;padding:84px 96px;display:flex;flex-direction:column;justify-content:space-between;-webkit-font-smoothing:antialiased}
.mark{font-family:Oswald,sans-serif;font-weight:500;font-size:30px;letter-spacing:.02em}
h1{font-size:${title.length > 48 ? 58 : 72}px;line-height:1.12;font-weight:400;letter-spacing:-.02em;max-width:980px;text-wrap:balance}
p{font-size:24px;color:#767676}
</style></head><body>
<div class="mark">${esc(cfg.mark || cfg.name)}</div>
<h1>${esc(title)}</h1>
<p>${esc(kicker)}</p>
</body></html>`;
}

// Renders one PNG per post (plus the home page) with headless Chrome.
// Cached by content, so rebuilds are instant; skipped quietly if Chrome is missing.
function shareCards(cfg, posts) {
  const out = {};
  if (!CHROME) return out;
  const cache = path.join(ROOT, ".cache", "og");
  fs.mkdirSync(cache, { recursive: true });
  const host = cfg.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const jobs = [{ slug: "", title: cfg.title + ". " + cfg.intro, kicker: host }].concat(
    posts.map((p) => ({ slug: p.slug, title: p.title, kicker: `${fmtDate(p.date)} · ${host}` }))
  );
  for (const j of jobs) {
    const html = cardHtml(cfg, j.title, j.kicker);
    const hash = crypto.createHash("sha1").update(html).digest("hex").slice(0, 10);
    const png = path.join(cache, `${j.slug || "home"}-${hash}.png`);
    if (!fs.existsSync(png)) {
      const src = path.join(cache, "card.html");
      fs.writeFileSync(src, html);
      try {
        const linux = process.platform === "linux" ? ["--no-sandbox"] : [];
        execFileSync(CHROME, [...linux, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
          "--window-size=1200,627", `--screenshot=${png}`, `file://${src}`], { stdio: "ignore", timeout: 30000 });
      } catch { continue; }
    }
    const name = `og/${j.slug || "home"}-${hash}.png`;
    fs.mkdirSync(path.join(OUT, "og"), { recursive: true });
    fs.copyFileSync(png, path.join(OUT, name));
    out[j.slug] = "/" + name;
  }
  return out;
}

function build() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  if (fs.existsSync(STATIC)) fs.cpSync(STATIC, OUT, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "src/style.css"), path.join(OUT, "style.css"));
  fs.copyFileSync(path.join(ROOT, "src/site.js"), path.join(OUT, "site.js"));

  const posts = fs
    .readdirSync(POSTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, body } = parseFile(path.join(POSTS, f));
      const slug = data.slug || f.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
      return { ...data, slug, body, html: markdown(body), minutes: readingTime(body) };
    })
    .filter((p) => p.draft !== "true")
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const cards = shareCards(cfg, posts);
  for (const p of posts) {
    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
      cfg.url.replace(/\/$/, "") + `/${p.slug}/`
    )}`;
    const [y, m, d] = p.date.split("-");
    const body = `<article>
  <header class="article-head">
    <p class="meta"><time class="odo" datetime="${p.date}">${m} ${d} <span>${y}</span></time></p>
    <h1>${esc(p.title)}</h1>
    ${p.description ? `<p class="lede">${esc(p.description)}</p>` : ""}
  </header>
  <div class="prose">
${p.html}
  </div>
  <footer class="article-foot">
    <a href="/">All writing</a>
    <a href="${shareUrl}" target="_blank" rel="noopener">Share on LinkedIn</a>
  </footer>
</article>`;
    write(
      `${p.slug}/index.html`,
      layout(cfg, {
        title: p.title,
        description: p.description || cfg.description,
        body,
        path: `/${p.slug}/`,
        type: "article",
        image: p.image || cards[p.slug],
        date: p.date,
      })
    );
  }

  const seen = new Set();
  const list = posts
    .map((p) => {
      const [y, m, d] = p.date.split("-");
      const first = !seen.has(y) && seen.add(y);
      return `    <li${first ? ` id="y${y}"` : ""}><a href="/${p.slug}/">
      <time datetime="${p.date}" data-ago><span class="md">${m}-${d}</span><span class="ago" aria-hidden="true"></span></time>
      <span class="title">${esc(p.title)}</span>
      ${p.description ? `<span class="desc">${esc(p.description)}</span>` : ""}
    </a></li>`;
    })
    .join("\n");
  // The dial: one tick per post, a year label where each year begins.
  const ticks = posts
    .map((p, i) => {
      const y = p.date.slice(0, 4);
      const starts = i === 0 || posts[i - 1].date.slice(0, 4) !== y;
      return `      <span class="tick${starts ? " tick--major" : ""}" style="--i:${i}"></span>${
        starts ? `\n      <a class="yr" href="#y${y}" style="--i:${i}">${y}</a>` : ""
      }`;
    })
    .join("\n");
  const rail = `  <nav class="dial" aria-label="Years" style="--n:${posts.length}">
    <div class="dial-strip">
${ticks}
    </div>
    <span class="dial-pointer" aria-hidden="true"></span>
  </nav>`;

  write(
    "index.html",
    layout(cfg, {
      description: cfg.description,
      path: "/",
      active: "home",
      image: cards[""],
      rail,
      body: `<h1 class="visually-hidden">${esc(cfg.name)} · ${esc(cfg.title)}</h1>
<ol class="posts" reversed>
${list}
</ol>`,
    })
  );

  if (fs.existsSync(PAGES)) {
    for (const f of fs.readdirSync(PAGES).filter((f) => f.endsWith(".md"))) {
      const { data, body } = parseFile(path.join(PAGES, f));
      const slug = f.replace(/\.md$/, "");
      write(
        `${slug}/index.html`,
        layout(cfg, {
          title: data.title,
          description: data.description || cfg.description,
          path: `/${slug}/`,
          active: slug,
          body: `<article>
  <header class="article-head"><h1>${esc(data.title)}</h1>${
            data.description ? `<p class="lede">${esc(data.description)}</p>` : ""
          }</header>
  <div class="prose">
${markdown(body)}
  </div>
</article>`,
        })
      );
    }
  }

  const base = cfg.url.replace(/\/$/, "");
  write(
    "feed.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(cfg.name)} · ${esc(cfg.title)}</title><link>${base}/</link><description>${esc(cfg.description)}</description>
${posts
  .map(
    (p) =>
      `<item><title>${esc(p.title)}</title><link>${base}/${p.slug}/</link><guid>${base}/${p.slug}/</guid><pubDate>${new Date(
        p.date + "T00:00:00Z"
      ).toUTCString()}</pubDate><description>${esc(p.description || "")}</description></item>`
  )
  .join("\n")}
</channel></rss>
`
  );

  write(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/</loc></url>
${posts.map((p) => `<url><loc>${base}/${p.slug}/</loc><lastmod>${p.date}</lastmod></url>`).join("\n")}
</urlset>
`
  );

  console.log(`Built ${posts.length} posts → dist/`);
}

build();

/* ---------------- dev server ---------------- */

if (process.argv.includes("--serve")) {
  const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4000;
  const types = { ".html": "text/html", ".css": "text/css", ".xml": "application/xml", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };
  http
    .createServer((req, res) => {
      let p = path.join(OUT, decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(OUT)) return res.writeHead(403).end();
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
      if (!fs.existsSync(p)) return res.writeHead(404).end("Not found");
      res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    })
    .listen(PORT, () => console.log(`Serving on http://localhost:${PORT}`));

  let t;
  for (const dir of [POSTS, PAGES, path.join(ROOT, "src"), STATIC]) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(t);
      t = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 80);
    });
  }
}
