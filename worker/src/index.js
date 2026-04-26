// personaOS publish worker
// Verifies admin password and commits data.json to uuu4/personaOS via GitHub API.
// Secrets (set via `wrangler secret put`):
//   GITHUB_TOKEN     — fine-grained PAT, Contents: Read & Write on uuu4/personaOS
//   ADMIN_PASSWORD   — plaintext password for the admin login

const REPO   = 'uuu4/personaOS';
const PATH   = 'data.json';
const BRANCH = 'main';

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
