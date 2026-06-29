// personaOS publish worker
// Verifies admin password and commits data.json to uuu4/personaOS via GitHub API.
// Secrets (set via `wrangler secret put`):
//   GITHUB_TOKEN     — fine-grained PAT, Contents: Read & Write on uuu4/personaOS
//   ADMIN_PASSWORD   — plaintext password for the admin login

const REPO   = 'uuu4/personaOS';
const PATH   = 'data.json';
const BRANCH = 'main';
const SITE   = 'https://internetpersona.net'; // where humans get redirected

// Adjust if you serve the site elsewhere; '*' is fine since auth is the password
const ALLOWED_ORIGINS = ['https://internetpersona.net', 'http://localhost:8000', 'http://127.0.0.1:8000'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response('personaOS publish worker — POST /verify or /publish', { headers: { ...cors, 'Content-Type': 'text/plain' } });
    }

    // ── GET /pdf?url=… — server-side PDF proxy (bypasses CORS on origin servers) ──
    if (req.method === 'GET' && url.pathname === '/pdf') {
      const pdfUrl = url.searchParams.get('url');
      if (!pdfUrl) return new Response('missing url param', { status: 400, headers: cors });
      let parsedUrl;
      try { parsedUrl = new URL(pdfUrl); } catch { return new Response('invalid url', { status: 400, headers: cors }); }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return new Response('only http/https allowed', { status: 400, headers: cors });
      }
      try {
        const upstream = await fetch(parsedUrl.href, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; personaOS-pdf-proxy/1.0)',
            'Accept': 'application/pdf,*/*'
          },
          redirect: 'follow'
        });
        const ct = upstream.headers.get('Content-Type') || 'application/pdf';
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            ...cors,
            'Content-Type': ct,
            'Cache-Control': 'public, max-age=86400'
          }
        });
      } catch (e) {
        return new Response('fetch failed: ' + String(e.message || e), { status: 502, headers: cors });
      }
    }

    // ── GET /card/:id.svg — templated SVG share card (id '_default' = banner) ──
    if (req.method === 'GET' && url.pathname.startsWith('/card/') && url.pathname.endsWith('.svg')) {
      const id = decodeURIComponent(url.pathname.slice(6, -4));
      const p = (await getPapers()).find(x => x.id === id);
      return new Response(renderCard(p), { headers: { ...cors, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
    }

    // ── GET /p/:id — OG meta page for crawlers, JS-redirect for humans ──
    if (req.method === 'GET' && url.pathname.startsWith('/p/')) {
      const id = decodeURIComponent(url.pathname.slice(3));
      return paperPage(id, url.origin, cors);
    }

    // ── Guestbook (Cloudflare KV — never committed to GitHub) ──
    if (url.pathname === '/guestbook') {
      if (req.method === 'GET') return guestbookList(env, cors, false);
      if (req.method === 'POST') {
        let b;
        try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
        if (b.action) {
          // admin moderation actions require the password
          if (!env.ADMIN_PASSWORD || !ctEq(String(b.password || ''), env.ADMIN_PASSWORD)) {
            await new Promise(r => setTimeout(r, 800));
            return json({ error: 'unauthorized' }, 401, cors);
          }
          return guestbookAdmin(b, env, cors);
        }
        return guestbookSubmit(b, req, env, cors);
      }
    }

    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);

    if (!env.GITHUB_TOKEN || !env.ADMIN_PASSWORD) {
      return json({ error: 'worker not configured (missing secrets)' }, 500, cors);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }

    if (!ctEq(String(body.password || ''), env.ADMIN_PASSWORD)) {
      // small delay to slow brute force
      await new Promise(r => setTimeout(r, 800));
      return json({ error: 'unauthorized' }, 401, cors);
    }

    if (url.pathname === '/verify') {
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === '/publish') {
      if (!body.data || typeof body.data !== 'object' || !Array.isArray(body.data.papers)) {
        return json({ error: 'invalid payload — expected { data: { papers, cv } }' }, 400, cors);
      }
      try {
        const result = await commitDataJson(body.data, body.message, env.GITHUB_TOKEN);
        return json({ ok: true, ...result }, 200, cors);
      } catch (e) {
        return json({ error: 'github error', detail: String(e.message || e) }, 502, cors);
      }
    }

    return json({ error: 'not found' }, 404, cors);
  }
};

async function commitDataJson(data, message, token) {
  const ghHeaders = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'personaOS-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // Fetch current SHA so updates don't 409
  let sha;
  const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`, { headers: ghHeaders });
  if (getRes.ok) {
    const cur = await getRes.json();
    sha = cur.sha;
  } else if (getRes.status !== 404) {
    throw new Error(`get contents ${getRes.status}`);
  }

  const content = b64encode(JSON.stringify(data, null, 2) + '\n');
  const safeMsg = (message && String(message).slice(0, 200)) || 'Update data.json via personaOS';
  const putBody = { message: safeMsg, content, branch: BRANCH };
  if (sha) putBody.sha = sha;

  const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody)
  });
  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`put contents ${putRes.status}: ${err.slice(0, 200)}`);
  }
  const out = await putRes.json();
  return { commit: out.commit?.sha, htmlUrl: out.commit?.html_url };
}

// ── Share cards (OG) ──────────────────────────────────────
// ponytail: 60s in-isolate cache of data.json. Good enough; no KV/D1 needed.
let _papersCache = null, _papersTs = 0;
async function getPapers() {
  if (_papersCache && Date.now() - _papersTs < 60000) return _papersCache;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${PATH}`, { headers: { 'User-Agent': 'personaos-worker' } });
    if (r.ok) { const d = await r.json(); _papersCache = d.papers || []; _papersTs = Date.now(); }
  } catch {}
  return _papersCache || [];
}

function xesc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrapText(s, max, maxLines) {
  const words = String(s || '').trim().split(/\s+/);
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && lines[maxLines - 1].length > max - 1) lines[maxLines - 1] = lines[maxLines - 1].slice(0, max - 1) + '…';
  return lines;
}

function renderCard(p) {
  const title = p ? p.title : 'personaOS';
  const titleLines = wrapText(title, 26, 3);
  const authors = p ? (p.authors || '') : 'a retro desktop library for academic papers';
  const venue = p ? [p.venue, p.year].filter(Boolean).join(' · ') : 'internetpersona.net';
  const tags = p ? (p.tags || []).slice(0, 5) : [];
  const rating = p ? (p.rating || 0) : 0;
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

  let ty = 250;
  const titleSvg = titleLines.map(l => { const y = ty; ty += 78; return `<text x="80" y="${y}" font-family="Georgia,serif" font-size="62" font-weight="bold" fill="#1c120a">${xesc(l)}</text>`; }).join('');

  let tx = 80;
  const tagSvg = tags.map(t => {
    const w = 28 + t.length * 15;
    const chip = `<g><rect x="${tx}" y="498" width="${w}" height="40" rx="4" fill="#ede0bc" stroke="#7a6030"/><text x="${tx + 14}" y="525" font-family="monospace" font-size="22" fill="#5a4828">${xesc(t)}</text></g>`;
    tx += w + 10;
    return tx < 1120 ? chip : '';
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f3e8cc"/>
  <rect x="14" y="14" width="1172" height="602" fill="none" stroke="#1a1008" stroke-width="3"/>
  <rect x="14" y="14" width="1172" height="12" fill="#c87820"/>
  ${p ? `<text x="80" y="130" font-family="monospace" font-size="26" fill="#8a6838">📚 personaOS · paper review</text>` : `<text x="80" y="130" font-family="monospace" font-size="26" fill="#8a6838">📚 personaOS</text>`}
  ${titleSvg}
  <text x="80" y="${Math.min(ty + 10, 450)}" font-family="monospace" font-size="28" font-style="italic" fill="#5a4828">${xesc(authors).slice(0, 60)}</text>
  ${tagSvg}
  <text x="80" y="595" font-family="monospace" font-size="24" fill="#8a6838">${xesc(venue)}</text>
  ${p ? `<text x="1120" y="130" text-anchor="end" font-family="monospace" font-size="34" fill="#c87820">${stars}</text>` : ''}
  <text x="1120" y="595" text-anchor="end" font-family="monospace" font-size="22" fill="#8a6838">internetpersona.net</text>
</svg>`;
}

async function paperPage(id, base, cors) {
  const p = (await getPapers()).find(x => x.id === id);
  const title = p ? p.title : 'personaOS';
  const desc = (p ? (p.abstract || p.notes || '') : 'A retro desktop-style library for academic papers.').replace(/\s+/g, ' ').trim().slice(0, 180);
  const img = `${base}/card/${encodeURIComponent(id)}.svg`;
  const target = `${SITE}/?paper=${encodeURIComponent(id)}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${xesc(title)} — personaOS</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="article">
<meta property="og:title" content="${xesc(title)}">
<meta property="og:description" content="${xesc(desc)}">
<meta property="og:url" content="${xesc(target)}">
<meta property="og:image" content="${xesc(img)}">
<meta property="og:image" content="${base}/card/_default.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${xesc(title)}">
<meta name="twitter:description" content="${xesc(desc)}">
<meta name="twitter:image" content="${xesc(img)}">
<meta http-equiv="refresh" content="0;url=${xesc(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head><body style="font-family:monospace;background:#09080a;color:#e8c060;text-align:center;padding:48px 20px">
<p>Redirecting to personaOS…</p>
<p><a href="${xesc(target)}" style="color:#c87820">Open “${xesc(title)}” →</a></p>
</body></html>`;
  return new Response(html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
}

// ── Guestbook storage: single KV key 'guestbook' holding the entry array ──
// ponytail: single-key read-modify-write. Fine for a personal site's traffic;
// switch to per-entry keys only if concurrent writes ever actually collide.
const GB_KEY = 'guestbook';

async function gbRead(env) {
  return JSON.parse((await env.GUESTBOOK.get(GB_KEY)) || '[]');
}

async function guestbookList(env, cors, all) {
  if (!env.GUESTBOOK) return json({ entries: [] }, 200, cors);
  const arr = await gbRead(env);
  const out = (all ? arr : arr.filter(e => e.approved)).sort((a, b) => b.ts - a.ts);
  return json({ entries: out }, 200, cors);
}

async function guestbookSubmit(b, req, env, cors) {
  if (!env.GUESTBOOK) return json({ error: 'guestbook not configured' }, 500, cors);
  // Honeypot: bots fill hidden fields. Pretend success so they don't retry.
  if (b.website || b.url) return json({ ok: true }, 200, cors);

  const name = String(b.name || '').trim().slice(0, 40) || 'anon';
  const message = String(b.message || '').trim().slice(0, 280);
  if (!message) return json({ error: 'message required' }, 400, cors);

  // Rate limit: one note per IP per minute.
  const ip = req.headers.get('CF-Connecting-IP') || '0';
  const rlKey = 'rl:' + ip;
  if (await env.GUESTBOOK.get(rlKey)) {
    return json({ error: 'slow down — one note per minute' }, 429, cors);
  }
  await env.GUESTBOOK.put(rlKey, '1', { expirationTtl: 60 });

  const arr = await gbRead(env);
  arr.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 6), name, message, ts: Date.now(), approved: false });
  await env.GUESTBOOK.put(GB_KEY, JSON.stringify(arr.slice(-500))); // cap growth
  return json({ ok: true }, 200, cors);
}

async function guestbookAdmin(b, env, cors) {
  if (!env.GUESTBOOK) return json({ error: 'guestbook not configured' }, 500, cors);
  if (b.action === 'list') return guestbookList(env, cors, true);
  const arr = await gbRead(env);
  let next;
  if (b.action === 'approve') next = arr.map(e => e.id === b.id ? { ...e, approved: true } : e);
  else if (b.action === 'delete') next = arr.filter(e => e.id !== b.id);
  else return json({ error: 'unknown action' }, 400, cors);
  await env.GUESTBOOK.put(GB_KEY, JSON.stringify(next));
  return guestbookList(env, cors, true);
}

function ctEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function b64encode(str) {
  // UTF-8 safe base64 in Workers runtime
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
