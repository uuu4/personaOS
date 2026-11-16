/* internetpersona — direction E: OS-first. Two views (OS windows / zine) over one data.json. Standalone (does not load app.js).
   Reused from app.js: esc, mdInline/mdToHtml, tag palette, guestbook load/submit, terminal commands, hacker mode. */
'use strict';
const WORKER_URL = 'https://personaos-publish.uuu4.workers.dev';
const $ = (s, r = document) => r.querySelector(s);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const _ESC = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => _ESC[c]);
const safeHref = u => /^(https?:\/\/|mailto:)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

let gbEntries = [], gbErr = '';
let D = { papers: [], cv: {}, note: '', readingList: [], work: [], posts: [] };
const sortedPosts = () => [...D.posts].sort((a, b) => String(b.date).localeCompare(String(a.date)));

/* ── markdown subset (same as app.js) ── */
function mdInline(s) {
  return s.replace(/`([^`]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
          .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<i>$2</i>')
          .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function mdToHtml(src) {
  return String(src || '').replace(/\r/g, '').split(/\n{2,}/).map(b => {
    let lines = b.split('\n').filter(l => l.trim()); if (!lines.length) return '';
    let head = '';
    if (/^## /.test(lines[0])) { head = `<h3>${mdInline(esc(lines[0].slice(3)))}</h3>`; lines = lines.slice(1); if (!lines.length) return head; }
    if (lines.every(l => /^- /.test(l))) return head + `<ul>${lines.map(l => `<li>${mdInline(esc(l.slice(2)))}</li>`).join('')}</ul>`;
    if (/^```/.test(lines[0]) && /^```\s*$/.test(lines[lines.length - 1]) && lines.length > 1) return head + `<pre><code>${esc(b.replace(/^[\s\S]*?```[^\n]*\n/, '').replace(/\n```\s*$/, ''))}</code></pre>`;
    if (lines.every(l => /^!\[[^\]]*\]\(((assets\/[\w\/.-]+)|(https:\/\/[^)\s]+))\)$/.test(l))) return head + lines.map(l => { const m = l.match(/^!\[([^\]]*)\]\(([^)]+)\)$/); return `<figure><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy" decoding="async"></figure>`; }).join('');
    if (lines.length > 1 && lines.every(l => /^\|.*\|\s*$/.test(l)) && /^\|[\s:|-]+\|\s*$/.test(lines[1])) {
      const cells = l => l.trim().slice(1, -1).split('|').map(c => mdInline(esc(c.trim())));
      return head + `<div class="tbl"><table><thead><tr>${cells(lines[0]).map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${lines.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return head + `<p>${lines.map(l => mdInline(esc(l))).join('<br>')}</p>`;
  }).join('');
}
const plainParas = t => String(t || '').replace(/\r/g, '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const readMins = body => Math.max(1, Math.round(String(body || '').split(/\s+/).length / 210));
const fmtDate = d => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

/* ── tag chips (palette from app.js) ── */
const TAG_PALETTE = [
  {bg:'#2c4a1c',border:'#4a7830',text:'#b8e890'},{bg:'#1c2c4a',border:'#2a4878',text:'#90b8e8'},
  {bg:'#4a1c2c',border:'#782a48',text:'#e890b8'},{bg:'#3a2c1c',border:'#6a5030',text:'#e8c890'},
  {bg:'#2a1c4a',border:'#4a3078',text:'#c890e8'},{bg:'#1c3a3a',border:'#2a6060',text:'#90e0e0'},
  {bg:'#3a3a1c',border:'#606030',text:'#e0e090'},
];
function tagHTML(t) { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) & 0xff; const c = TAG_PALETTE[h % TAG_PALETTE.length];
  return `<span class="tag" style="background:${c.bg};border-color:${c.border};color:${c.text}">${esc(t)}</span>`; }

/* ── pixel star mask ── */
(function () {
  const g = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
  let r = ''; g.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 7" shape-rendering="crispEdges">${r}</svg>`;
  document.documentElement.style.setProperty('--star', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
})();
const starsHTML = n => !n ? `<span class="kind">unrated</span>` : `<span class="stars" role="img" aria-label="${n} out of 5">${[1,2,3,4,5].map(i => `<span class="star ${i <= n ? 'lit' : ''}"></span>`).join('')}</span>`;

let toastT;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ── UI sounds (Web Audio, no files). The context is created on the first real user gesture only, never at load. ── */
let sfx = null;
function playSound(type) {
  if (!prefs.sounds || paused) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    if (!sfx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; sfx = new AC(); }
    if (sfx.state === 'suspended') sfx.resume();
    const o = sfx.createOscillator(), g = sfx.createGain(), t = sfx.currentTime; o.connect(g); g.connect(sfx.destination);
    const S = { open: ['sine', 380, 760, .07, .12, .10], close: ['sine', 520, 180, .08, .10, .10], min: ['triangle', 440, 280, .05, .08, .07], click: ['square', 1100, 1100, .02, .05, .022] }[type];
    if (!S) return; o.type = S[0]; o.frequency.setValueAtTime(S[1], t); o.frequency.linearRampToValueAtTime(S[2], t + S[3]);
    g.gain.setValueAtTime(S[4], t); g.gain.linearRampToValueAtTime(0, t + S[5]); o.start(t); o.stop(t + S[5]);
  } catch (e) {}
}

/* ── PDF first-page previews: pdf.js is injected on first need; each URL renders once and is cached as an image ── */
const PDFJS = 'https://unpkg.com/pdfjs-dist@3.11.174/build/';
let pdfjsP = null;
function loadPdfjs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return pdfjsP || (pdfjsP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfjsP = null; rej(new Error('pdf.js')); }; document.head.appendChild(s);
  }));
}
const pdfCache = new Map();
function pdfImage(url) {
  if (pdfCache.has(url)) return pdfCache.get(url);
  const p = (async () => {
    const lib = await loadPdfjs();
    const render = async u => {
      const doc = await lib.getDocument({ url: u, withCredentials: false }).promise;
      try { const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 720 / v1.width });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        return await new Promise(r => c.toBlob(b => r(b ? URL.createObjectURL(b) : c.toDataURL('image/png')), 'image/png'));
      } finally { doc.destroy(); }
    };
    // our own worker URLs (e.g. /cv) are fetched directly; anything else goes through the worker's /pdf proxy (origin servers rarely send CORS headers)
    if (url.startsWith(WORKER_URL)) return render(url);
    try { return await render(WORKER_URL + '/pdf?url=' + encodeURIComponent(url)); } catch (e) { return render(url); }
  })();
  p.catch(() => pdfCache.delete(url)); pdfCache.set(url, p); return p;
}
const pdfBoxHTML = (url, label) => /^https?:\/\//i.test(String(url || '').trim())
  ? `<a class="pdf-box" href="${safeHref(url)}" target="_blank" rel="noopener noreferrer" data-pdf="${esc(String(url).trim())}" aria-label="${esc(label || 'open pdf')}"><span class="pdf-ph">loading…</span></a>` : '';
let pdfIO = null;
function fillPdf(box) {
  if (box.dataset.done) return; box.dataset.done = '1';
  pdfImage(box.dataset.pdf).then(src => { if (!box.isConnected) return; box.innerHTML = `<img src="${src}" alt="">`; box.classList.add('ok'); })
    .catch(() => { if (box.isConnected) $('.pdf-ph', box).textContent = 'preview unavailable'; });
}
// windows fill right away; zine blocks fill only when scrolled near, so nothing is fetched during boot
function hydrate(root) {
  root.querySelectorAll('[data-pdf]:not([data-done]),[data-gh]:not([data-done])').forEach(el => {
    const fill = () => (el.dataset.pdf ? fillPdf(el) : fillGh(el));
    if (!el.closest('#zine') || !('IntersectionObserver' in window)) { fill(); return; }
    pdfIO = pdfIO || new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { pdfIO.unobserve(e.target); (e.target.dataset.pdf ? fillPdf : fillGh)(e.target); } }), { rootMargin: '300px 0px' });
    pdfIO.observe(el);
  });
}

/* ── GitHub contributions (public API, CORS *, fetched once per user) ── */
const ghCache = new Map();
function ghData(user) {
  if (!ghCache.has(user)) { const p = fetch(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=last`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); p.catch(() => ghCache.delete(user)); ghCache.set(user, p); }
  return ghCache.get(user);
}
function fillGh(el) {
  el.dataset.done = '1'; const user = el.dataset.gh;
  ghData(user).then(d => {
    if (!el.isConnected) return; const cs = d.contributions || []; if (!cs.length) throw new Error('empty');
    const pad = new Date(cs[0].date + 'T12:00:00Z').getUTCDay(), total = (+(d.total && d.total.lastYear) || cs.reduce((s, c) => s + (+c.count || 0), 0)) | 0;
    el.innerHTML = `<div class="gh-scroll"><div class="gh-grid">${'<i class="gh-pad"></i>'.repeat(pad)}${cs.map(c => `<i class="gh-l${Math.min(4, Math.max(0, c.level | 0))}" title="${esc(c.date)}: ${+c.count | 0}"></i>`).join('')}</div></div><a class="gh-total" href="https://github.com/${encodeURIComponent(user)}" target="_blank" rel="noopener noreferrer">${total} contributions in the last year</a>`;
    const sc = $('.gh-scroll', el); sc.scrollLeft = sc.scrollWidth;
  }).catch(() => { if (el.isConnected) el.innerHTML = `<p class="empty">couldn't load contributions.</p>`; });
}

/* ═══════════ CONTENT: one source (data.json), two views (OS windows / zine) ═══════════ */
const APPS = {
  posts: { file: 'posts.exe', label: 'Posts', w: 420, h: 440 },
  work: { file: 'work/', label: 'Work', w: 440, h: 460 },
  reviews: { file: 'reviews/', label: 'Reviews', w: 480, h: 440 },
  reading: { file: 'reading.txt', label: 'Reading', w: 360, h: 400 },
  about: { file: 'about_me.cv', label: 'About', w: 500, h: 540 },
  guestbook: { file: 'guestbook', label: 'Guestbook', w: 380, h: 460 },
};
const mounts = [];
function mount(id, el, mode) { mounts.push({ id, el, mode }); R[id](el, mode); hydrate(el); }
const KEEP = ['.rl-title', '.rl-link'];
function refreshMounts() { for (let i = mounts.length - 1; i >= 0; i--) { const m = mounts[i]; if (!m.el.isConnected) { mounts.splice(i, 1); continue; } const kept = KEEP.map(s => $(s, m.el)?.value); R[m.id](m.el, m.mode); KEEP.forEach((s, j) => { const el = $(s, m.el); if (el && kept[j]) el.value = kept[j]; }); hydrate(m.el); } refreshPaperWins(); }
const adminBar = extra => isAdmin() ? `<div class="admin-tools">${extra || ''}<button class="btn btn--ghost" type="button" data-act="publish">publish</button></div>` : '';
const zh = (icon, title) => `<div class="z-head"><img src="assets/icons/${icon}.png" alt="" width="48" height="48"><h2>${title}</h2></div>`;
const R = {
  posts(el, mode) {
    const z = mode === 'zine', list = sortedPosts();
    el.innerHTML = (z ? zh('posts', 'Posts') : '') +
      (!z ? adminBar(`<button class="btn" type="button" data-act="new-post">+ new post</button>`) : '') +
      (list.length ? `<ul class="post-list">${list.map(p => `<li><a class="post-row" href="?post=${encodeURIComponent(p.id)}" data-post="${esc(p.id)}"><span class="post-date">${esc(fmtDate(p.date))}</span><span class="post-title">${esc(p.title)}</span>${p.summary ? `<span class="post-sum">${esc(p.summary)}</span>` : ''}</a></li>`).join('')}</ul>` : `<p class="empty">no posts yet.</p>`);
  },
  work(el, mode) {
    const z = mode === 'zine';
    const group = (kind, label) => {
      const items = D.work.filter(w => w.kind === kind); if (!items.length) return '';
      return `<h3 class="grp">${label}</h3><div class="cards">` + items.map(w => {
        const st = (w.status || '').toLowerCase().replace(/[^a-z]+/g, '-');
        return `<article class="card"><div class="card-top">${w.status ? `<span class="badge badge--${st}">${esc(w.status)}</span>` : ''}</div><h3>${esc(w.title)}</h3>${w.venue ? `<div class="meta">${esc(w.venue)}</div>` : ''}${w.blurb ? `<p class="blurb">${esc(w.blurb)}</p>` : ''}${w.link ? `<div class="card-link"><a class="btn btn--teal" href="${safeHref(w.link)}" target="_blank" rel="noopener noreferrer">${esc(w.linkLabel || 'link')} ↗</a></div>` : ''}</article>`;
      }).join('') + `</div>`;
    };
    el.innerHTML = (z ? zh('work', 'Work') : '') + (group('paper', 'Papers') + group('project', 'Projects') || '<p class="empty">nothing here yet.</p>');
  },
  reviews(el, mode) {
    const z = mode === 'zine';
    el.innerHTML = (z ? zh('reviews', 'Reviews') : adminBar(`<button class="btn" type="button" data-act="add-paper">+ add paper</button>`)) + `<div class="${z ? 'cards' : 'rgrid'}">${D.papers.map(p => {
      const notes = (p.notes || '').trim();
      if (!z) return `<button type="button" class="rcard" data-act="open-notes" data-id="${esc(p.id)}">${starsHTML(p.rating || 0)}<span class="rt">${esc(p.title)}</span></button>`;
      return `<article class="card" id="paper-${esc(p.id)}"><div class="card-top">${starsHTML(p.rating || 0)}</div><h3>${esc(p.title)}</h3>${paperMeta(p) ? `<div class="meta">${esc(paperMeta(p))}</div>` : ''}<div class="tags">${(p.tags || []).slice(0, 4).map(tagHTML).join('')}</div>${(p.abstract || '').trim() ? `<details class="notes"><summary>abstract</summary><div class="prose">${plainParas(p.abstract)}</div></details>` : ''}${notes ? `<details class="notes"><summary>my notes</summary><div class="prose">${plainParas(notes)}</div></details>` : ''}${p.pdfUrl ? `<div class="card-link"><a class="btn btn--ghost" href="${safeHref(p.pdfUrl)}" target="_blank" rel="noopener noreferrer">paper ↗</a></div>` : ''}</article>`;
    }).join('')}</div>`;
  },
  reading(el, mode) {
    const z = mode === 'zine', adm = !z && isAdmin();
    el.innerHTML = (z ? zh('reading', 'Reading list') : '') +
      (adm ? `<div class="frm rl-add"><input class="rl-title" placeholder="title" aria-label="title"><input class="rl-link" type="url" placeholder="link (optional)" aria-label="link"><div class="frm-row"><button class="btn" type="button" data-act="rl-add">+ add</button><button class="btn btn--ghost" type="button" data-act="publish">publish</button></div></div>` : '') +
      (D.readingList.length ? `<ul class="rl">${D.readingList.map(it => `<li>${it.link ? `<a href="${safeHref(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>` : `<span>${esc(it.title)}</span>`}${adm ? `<button type="button" class="btn btn--ghost rl-del" data-act="rl-del" data-id="${esc(it.id)}" aria-label="remove ${esc(it.title)}">✕</button>` : ''}</li>`).join('')}</ul>` : `<p class="empty">nothing queued.</p>`);
  },
  about(el, mode) {
    const cv = D.cv || {}, z = mode === 'zine', interests = String(cv.interests || '').split(',').map(s => s.trim()).filter(Boolean), gh = String(cv.github || 'uuu4').trim() || 'uuu4';
    el.innerHTML = (z ? zh('about', 'About') : adminBar(`<button class="btn" type="button" data-act="cv-edit">edit profile</button>`)) + `<div class="about"><canvas class="about-pet" width="16" height="20" aria-hidden="true"></canvas><div><h3 class="name">${esc(cv.name || 'Ali Emre Aydın')}</h3>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}<p class="bio">${esc(cv.bio || '')}</p>${cv.affiliation ? `<p class="aff">${esc(cv.affiliation)}</p>` : ''}${interests.length ? `<div class="chips">${interests.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}<div class="about-links">${cv.cvUrl ? `<a class="btn" href="${safeHref(cv.cvUrl)}" target="_blank" rel="noopener noreferrer">CV (PDF) ↗</a>` : ''}<a class="btn btn--ghost" href="https://github.com/${encodeURIComponent(gh)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>${cv.email ? `<a class="btn btn--ghost" href="mailto:${esc(cv.email)}">email</a>` : ''}</div></div></div>
      <div class="about-extra">${cv.cvUrl ? `<div class="ax-cv"><h4>cv</h4>${pdfBoxHTML(cv.cvUrl, 'open CV (PDF)')}</div>` : ''}<div class="ax-gh"><h4>github</h4><div class="gh" data-gh="${esc(gh)}"><p class="empty">loading…</p></div></div></div>`;
    drawAboutPets();
  },
  guestbook(el, mode) {
    const cards = gbErr ? `<p class="empty">${esc(gbErr)}</p>` : gbEntries.length ? gbEntries.map(e => { const mod = isAdmin(), pend = mod && !e.approved;
      return `<div class="gb-card${pend ? ' gb-pending' : ''}"><div>${esc(e.message).replace(/\n/g, '<br>')}</div><div class="gb-meta">${esc(e.name || 'anon')}${pend ? ' · pending' : ''}</div>${mod ? `<div class="gb-mod">${pend ? `<button type="button" class="btn" data-gb="approve" data-id="${esc(e.id)}">approve</button>` : ''}<button type="button" class="btn" data-gb="delete" data-id="${esc(e.id)}">delete</button></div>` : ''}</div>`; }).join('') : `<p class="empty">no notes yet. be the first.</p>`;
    el.innerHTML = (mode === 'zine' ? zh('guestbook', 'Guestbook') : '') + `<div class="gb"><form class="gb-form" onsubmit="return false"><input class="gb-name" placeholder="your name (optional)" maxlength="40" aria-label="your name"><textarea class="gb-msg" rows="3" maxlength="280" placeholder="say hi…" aria-label="message"></textarea><input class="gb-honey" tabindex="-1" autocomplete="off" aria-hidden="true"><button type="button" class="btn" data-act="gb-send">Leave a note</button></form><div class="gb-list">${cards}</div></div>`;
  },
};
/* guestbook: public list + submit; admin sees pending notes with approve/delete */
document.addEventListener('click', e => { const b = e.target.closest('[data-gb]'); if (!b) return; const act = b.dataset.gb, id = b.dataset.id;
  if (act === 'delete') themedConfirm('Delete this note?', () => gbAction(act, id), { confirmLabel: 'Delete' }); else gbAction(act, id); });
async function gbAction(action, id) {
  let pass = ''; try { pass = sessionStorage.getItem(PW_KEY) || ''; } catch (e) {}
  if (!pass) { toast('Session expired — log in again'); return; }
  try { const r = await fetch(WORKER_URL + '/guestbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass, action, id }) });
    if (r.ok) { gbEntries = (await r.json()).entries || []; refreshMounts(); toast(action === 'approve' ? 'Approved ✓' : 'Deleted'); }
    else toast('Failed: ' + r.status);
  } catch (e) { toast('Network error'); }
}
async function loadGuestbook() {
  // The worker only allows CORS from internetpersona.net; skip the call on local previews to avoid a guaranteed console error.
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) { gbErr = 'guestbook loads on the live site.'; refreshMounts(); return; }
  const pass = isAdmin() ? (() => { try { return sessionStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; } })() : '';
  try {
    const r = pass ? await fetch(WORKER_URL + '/guestbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass, action: 'list' }) })
                   : await fetch(WORKER_URL + '/guestbook');
    gbEntries = (await r.json()).entries || []; gbErr = '';
  }
  catch (e) { gbErr = "couldn't reach the guestbook."; }
  refreshMounts();
}
async function submitGuestbook(btn) {
  const f = btn.closest('.gb-form'), msg = $('.gb-msg', f).value.trim();
  if (!msg) { toast('Write a message first'); return; }
  btn.disabled = true;
  try {
    const r = await fetch(WORKER_URL + '/guestbook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: $('.gb-name', f).value || '', message: msg, website: $('.gb-honey', f).value || '' }) });
    if (r.ok) { toast('Note sent — awaiting approval ✓'); loadGuestbook(); }
    else { const e = await r.json().catch(() => ({})); toast(e.error || ('Failed: ' + r.status)); }
  } catch (e) { toast('Network error'); }
  finally { btn.disabled = false; }
}

/* ── post reader + review notes (window in OS view, page in zine view) ── */
function postHTML(p, z) {
  const list = sortedPosts(), i = list.findIndex(x => x.id === p.id), prev = list[i + 1], next = list[i - 1], id = esc(p.id);
  return `<div class="reader-in">${z ? `<button type="button" class="btn btn--ghost zback" data-act="zine-home">&larr; posts</button>` : ''}<div class="reader-date">${esc(fmtDate(p.date))}</div><h1>${esc(p.title)}</h1><div class="px-rule"></div><div class="prose">${mdToHtml(p.body)}</div>
    <div class="reader-foot"><div class="pn">${prev ? `<a href="?post=${encodeURIComponent(prev.id)}" data-post="${esc(prev.id)}"><small>older</small><span>${esc(prev.title)}</span></a>` : '<div></div>'}${next ? `<a class="next" href="?post=${encodeURIComponent(next.id)}" data-post="${esc(next.id)}"><small>newer</small><span>${esc(next.title)}</span></a>` : '<div></div>'}</div>
    <div class="reader-actions">${z ? '' : `<button class="btn btn--ghost" type="button" data-act="copy-link" data-id="${id}">copy link</button>`}${isAdmin() ? `<button class="btn" type="button" data-act="edit-post" data-id="${id}">edit</button><button class="btn btn--ghost" type="button" data-act="delete-post" data-id="${id}">delete</button>` : ''}</div></div></div>`;
}
function renderPost(p, zine) {
  if (zine) { const r = $('#z-reader'); r.innerHTML = postHTML(p, true); $('#z-home').hidden = true; r.hidden = false; window.scrollTo(0, zineTop()); document.title = p.title + ' — internetpersona'; return; }
  const w = wins.reader; if (!w) return; setWinTitle('reader', p.id + '.md'); document.title = p.title + ' — internetpersona';
  w.body.innerHTML = postHTML(p, false); w.body.scrollTop = 0; $('.wprog i', w.el).style.width = '0';
}
function openPost(id, push = true, zine = false) {
  const p = D.posts.find(x => x.id === id); if (!p) return;
  if (zine) { renderPost(p, true); if (push) { try { history.replaceState({}, '', location.pathname + '?view=zine&post=' + encodeURIComponent(id)); } catch (e) {} } return; }
  openWin({ id: 'reader', side: true, title: p.id + '.md', icon: 'posts', width: 560, height: 560, progress: true, onClose: () => { document.title = DOC_TITLE; clearUrl('post'); } });
  renderPost(p); if (push && new URLSearchParams(location.search).get('post') !== id) setUrl('?post=' + encodeURIComponent(id));
}
const paperMeta = p => [String(p.authors || '').trim(), [p.venue && p.venue !== '—' ? p.venue : '', p.year || ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
const allTags = () => [...new Set(D.papers.flatMap(p => p.tags || []))].sort();
function paperBody(b, p) {
  const adm = isAdmin(), notes = (p.notes || '').trim(), abs = (p.abstract || '').trim(), id = esc(p.id);
  const stars = adm ? `<span class="stars stars--edit" role="group" aria-label="rating">${[1, 2, 3, 4, 5].map(i => `<button type="button" class="star ${i <= (p.rating || 0) ? 'lit' : ''}" data-act="rate" data-id="${id}" data-n="${i}" aria-label="rate ${i} of 5"></button>`).join('')}</span>` : starsHTML(p.rating || 0);
  const tags = adm ? `<div class="tags tags--edit">${(p.tags || []).map((t, i) => tagHTML(t).replace('</span>', `<button type="button" class="tag-x" data-act="tag-x" data-id="${id}" data-i="${i}" aria-label="remove tag ${esc(t)}">×</button></span>`)).join('')}<input class="tag-in" data-id="${id}" list="tag-list" placeholder="+ tag" aria-label="add tag"><datalist id="tag-list">${allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>` : `<div class="tags">${(p.tags || []).map(tagHTML).join('')}</div>`;
  b.innerHTML = `<div class="reader-in paper-win"><div class="paper-top">${pdfBoxHTML(p.pdfUrl, 'open paper (PDF)')}<div class="paper-head"><div class="reader-date">${stars}</div><h1 class="small">${esc(p.title)}</h1>${paperMeta(p) ? `<div class="paper-meta">${esc(paperMeta(p))}</div>` : ''}${tags}${p.pdfUrl ? `<p class="paper-link"><a class="btn btn--ghost" href="${safeHref(p.pdfUrl)}" target="_blank" rel="noopener noreferrer">paper ↗</a></p>` : ''}</div></div>
    ${abs ? `<h4 class="sub">abstract</h4><div class="prose prose--abs">${plainParas(abs)}</div>` : ''}
    <h4 class="sub">my notes</h4>${adm ? `<div class="frm"><textarea class="notes-in" rows="9" aria-label="notes">${esc(p.notes || '')}</textarea><label>pdf link<input class="pdf-in" type="url" value="${esc(p.pdfUrl || '')}" placeholder="https://arxiv.org/pdf/…"></label><div class="frm-row"><button class="btn" type="button" data-act="paper-save" data-id="${id}">save draft</button><button class="btn btn--ghost" type="button" data-act="publish">publish</button><button class="btn btn--ghost" type="button" data-act="paper-del" data-id="${id}">remove paper</button></div></div>` : `<div class="prose">${notes ? plainParas(notes) : '<p><i>no notes yet.</i></p>'}</div>`}</div>`;
  hydrate(b);
}
// re-render open paper windows, keeping any unsaved text in the notes / pdf fields (a star or tag click must not wipe it)
function refreshPaperWins() {
  Object.keys(wins).forEach(k => {
    if (!k.startsWith('notes-')) return; const w = wins[k], p = D.papers.find(x => 'notes-' + x.id === k); if (!p) { closeWin(k, true); return; }
    const keep = ['.notes-in', '.pdf-in'].map(s => $(s, w.body)?.value), st = w.body.scrollTop; paperBody(w.body, p);
    ['.notes-in', '.pdf-in'].forEach((s, i) => { const el = $(s, w.body); if (el && keep[i] != null) el.value = keep[i]; }); w.body.scrollTop = st;
  });
}
function openNotes(id, push = true) {
  const p = D.papers.find(x => x.id === id); if (!p) return;
  const slug = String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 26);
  openWin({ id: 'notes-' + id, side: true, title: slug + '.txt', icon: 'reviews', width: 540, height: 540, onClose: () => clearUrl('paper'), build: b => paperBody(b, p) });
  if (push && new URLSearchParams(location.search).get('paper') !== id) setUrl('?paper=' + encodeURIComponent(id));
}

/* ── admin editors: papers, reading list, sticky note, profile. Each edit lands in a section draft; publish sends everything. ── */
const findPaper = id => D.papers.find(x => x.id === id);
function paperChanged(p, msg) { saveDraft('papers'); refreshMounts(); if (msg) toast(msg); }
function setRating(id, n) { const p = findPaper(id); if (!p) return; p.rating = p.rating === n ? 0 : n; paperChanged(p, p.rating ? `rated ${p.rating}/5 ✓` : 'rating cleared'); }
function addTag(id, v) { const p = findPaper(id), t = String(v || '').trim().toLowerCase(); if (!p || !t) return; p.tags = p.tags || []; if (!p.tags.includes(t)) p.tags.push(t); paperChanged(p); setTimeout(() => $(`#win-notes-${CSS.escape(id)} .tag-in`)?.focus(), 30); }
function removeTag(id, i) { const p = findPaper(id); if (!p || !p.tags) return; p.tags.splice(+i, 1); paperChanged(p); }
function savePaper(id) {
  const p = findPaper(id), w = wins['notes-' + id]; if (!p || !w) return;
  p.notes = $('.notes-in', w.body).value; const u = $('.pdf-in', w.body).value.trim();
  if (u && !/^https?:\/\//i.test(u)) { toast('pdf link must start with http(s)://'); return; }
  p.pdfUrl = u; paperChanged(p, 'saved draft ✓ publish to go live');
}
function deletePaper(id) { themedConfirm('Remove this paper from reviews?', () => { D.papers = D.papers.filter(x => x.id !== id); closeWin('notes-' + id); paperChanged(null, 'paper removed (draft)'); }, { confirmLabel: 'Remove' }); }
function openAddPaper() {
  if (!isAdmin()) { toast('Admin only'); return; }
  openWin({ id: 'add-paper', title: 'add_paper.txt', icon: 'reviews', width: 500, height: 580, build: b => {
    b.innerHTML = `<div class="frm"><label for="ap-fetch">auto-fill from arXiv / DOI / link</label><div class="frm-row ap-fetch-row"><input id="ap-fetch" placeholder="arxiv.org/abs/… · 10.1038/… · 2303.14307"><button class="btn" type="button" id="ap-fetch-btn" data-act="ap-fetch">fetch</button></div><div id="ap-msg" class="frm-msg" role="status"></div>
      <label for="ap-title">title *</label><input id="ap-title"><label for="ap-authors">authors</label><input id="ap-authors">
      <div class="frm-row frm-2"><span><label for="ap-year">year</label><input id="ap-year" type="number" placeholder="${new Date().getFullYear()}"></span><span><label for="ap-venue">venue</label><input id="ap-venue"></span></div>
      <label for="ap-tags">tags (comma separated)</label><input id="ap-tags"><label for="ap-abstract">abstract</label><textarea id="ap-abstract" rows="6"></textarea><label for="ap-pdf">pdf link</label><input id="ap-pdf" type="url" placeholder="https://arxiv.org/pdf/…">
      <div class="frm-row"><button class="btn" type="button" data-act="ap-save">add to reviews</button><button class="btn btn--ghost" type="button" data-close="add-paper">Cancel</button></div></div>`;
    $('#ap-fetch', b).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); autofillPaper(); } }); setTimeout(() => $('#ap-fetch', b)?.focus(), 60);
  } });
}
async function autofillPaper() {
  const q = $('#ap-fetch')?.value.trim(), msg = $('#ap-msg'), btn = $('#ap-fetch-btn'); if (!msg) return;
  if (!q) { msg.textContent = 'paste an arXiv link/id or a DOI first'; return; }
  btn.disabled = true; msg.textContent = 'fetching…';
  try {
    const r = await fetch(WORKER_URL + '/meta?id=' + encodeURIComponent(q)), d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { msg.textContent = d.error || ('error ' + r.status); return; }
    const set = (k, v) => { const el = $('#' + k); if (el && v != null && v !== '') el.value = v; };
    set('ap-title', d.title); set('ap-authors', d.authors); set('ap-year', d.year); set('ap-venue', d.venue); set('ap-abstract', d.abstract); set('ap-pdf', d.pdfUrl);
    msg.textContent = 'filled ✓ check the fields, then add';
  } catch (e) { msg.textContent = "couldn't reach the worker"; }
  finally { btn.disabled = false; }
}
function submitAddPaper() {
  const v = k => ($('#' + k)?.value || '').trim(), title = v('ap-title'); if (!title) { toast('Title is required!'); return; }
  const pdf = v('ap-pdf'); if (pdf && !/^https?:\/\//i.test(pdf)) { toast('pdf link must start with http(s)://'); return; }
  const p = { id: 'p' + Date.now(), title, authors: v('ap-authors'), year: parseInt(v('ap-year'), 10) || new Date().getFullYear(), venue: v('ap-venue'),
    tags: v('ap-tags').split(',').map(t => t.trim().toLowerCase()).filter(Boolean), abstract: v('ap-abstract'), rating: 0, notes: '', icon: '📄', pdfUrl: pdf };
  D.papers.push(p); closeWin('add-paper'); paperChanged(p, 'paper added (draft)'); setTimeout(() => openNotes(p.id), 120);
}
function addReading(btn) {
  const f = btn.closest('.rl-add'), title = $('.rl-title', f).value.trim(), link = $('.rl-link', f).value.trim();
  if (!title) { toast('Title is required!'); return; } if (link && !/^https?:\/\//i.test(link)) { toast('link must start with http(s)://'); return; }
  D.readingList.push({ id: 'r' + Date.now(), title, link }); $('.rl-title', f).value = ''; $('.rl-link', f).value = ''; saveDraft('readingList'); refreshMounts(); toast('added (draft) ✓');
  setTimeout(() => $('#win-app-reading .rl-title')?.focus(), 30);
}
function deleteReading(id) { const it = D.readingList.find(x => x.id === id); if (!it) return; themedConfirm(`Remove "${it.title}"?`, () => { D.readingList = D.readingList.filter(x => x.id !== id); saveDraft('readingList'); refreshMounts(); }, { confirmLabel: 'Remove' }); }
function openNoteEditor() {
  if (!isAdmin()) return;
  openWin({ id: 'note-editor', title: 'sticky_note.txt', icon: 'about', width: 400, height: 380, build: b => {
    b.innerHTML = `<div class="frm"><label for="ne-text">sticky note <small>(the first paragraph stays hidden on the desktop)</small></label><textarea id="ne-text" rows="9">${esc(D.note || '')}</textarea><div class="frm-row"><button class="btn" type="button" data-act="note-save">save draft</button><button class="btn btn--ghost" type="button" data-close="note-editor">Cancel</button></div></div>`;
    setTimeout(() => $('#ne-text', b)?.focus(), 60);
  } });
}
function saveNote() { const t = $('#ne-text'); if (!t) return; D.note = t.value; saveDraft('note'); renderSticky(); closeWin('note-editor'); toast('saved draft ✓ publish to go live'); }
const CV_FIELDS = [['name', 'name'], ['role', 'role'], ['affiliation', 'affiliation'], ['bio', 'bio', 1], ['interests', 'interests (comma separated)'], ['email', 'email'], ['website', 'website'], ['cvUrl', 'cv pdf link'], ['github', 'github username']];
function openCvEditor() {
  if (!isAdmin()) return; const cv = D.cv || {};
  openWin({ id: 'cv-editor', title: 'edit_profile.cfg', icon: 'about', width: 480, height: 580, build: b => {
    b.innerHTML = `<div class="frm">${CV_FIELDS.map(([k, l, ta]) => `<label for="cv-${k}">${l}</label>${ta ? `<textarea id="cv-${k}" rows="4">${esc(cv[k] || '')}</textarea>` : `<input id="cv-${k}" value="${esc(cv[k] || (k === 'github' ? 'uuu4' : ''))}">`}`).join('')}
      <div class="frm-row"><button class="btn" type="button" data-act="cv-save">save draft</button><button class="btn btn--ghost" type="button" data-close="cv-editor">Cancel</button></div></div>`;
  } });
}
function saveCv() {
  const nv = {}; CV_FIELDS.forEach(([k]) => { const el = $('#cv-' + k); if (el) nv[k] = el.value.trim(); });
  if (nv.cvUrl && !/^https?:\/\//i.test(nv.cvUrl)) { toast('cv link must start with http(s)://'); return; }
  D.cv = Object.assign({}, D.cv, nv); saveDraft('cv'); closeWin('cv-editor'); refreshMounts(); toast('saved draft ✓ publish to go live');
}

/* ── hacker mode + terminal (commands from app.js) ── */
const ACCESS_GRANTED = `<span class="t-ok">ACCESS GRANTED</span>\n<span class="t-dim">decrypting filesystem... done\nmounting /root/classified... done</span>\n<span class="t-ok">a "root" link appeared in the footer.</span>\n<span class="t-dim">try: decrypt · lock (to undo)</span>`;
const SECRET_NOTE = `> ACCESS LEVEL: ROOT\n> /root/classified/readme.txt\n\nso you actually found it. respect.\n\nstuff that doesn't make the front page:\n  · i refactor when i should be sleeping\n  · the olympiad grind is 50% ego, 50% love\n  · every paper in here rewired how i think, a little\n\nif you're reading this, you went digging for it.\nthat says something about you too — we'd probably\nget along.\n\n  // type 'decrypt' in the terminal for one more thing\n  // 'lock' puts the lights back\n\n— ae · internetpersona`;
const DECRYPTED = `<span class="t-ok">DECRYPTING...</span>\n<span class="t-dim">key accepted.</span>\n\n"the best code is the code you never had to write."\n\n<span class="t-dim">p.s. you read the source. that's rare.\nsay hi in the guestbook · github.com/uuu4</span>`;
let matrixRAF = null;
function startMatrix() {
  const c = $('#matrix'), ctx = c.getContext('2d'), fit = () => { c.width = innerWidth; c.height = innerHeight; };
  fit(); addEventListener('resize', fit);
  const glyphs = 'アカサタナハマヤラワ0123456789ABCDEF<>/*$#', step = 16; let drops = Array(Math.ceil(c.width / step)).fill(0).map(() => Math.random() * -50), last = 0;
  const draw = t => {
    if (!document.body.classList.contains('hacker')) { matrixRAF = null; return; }
    if (t - last > 55) { last = t; ctx.fillStyle = 'rgba(0,8,0,0.16)'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#00ff5a'; ctx.font = '14px monospace';
      const cols = Math.ceil(c.width / step); if (drops.length !== cols) drops = Array(cols).fill(0).map((_, i) => drops[i] || 0);
      for (let i = 0; i < cols; i++) { ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * step, drops[i] * step); drops[i] = (drops[i] * step > c.height && Math.random() > .975) ? 0 : drops[i] + 1; } }
    matrixRAF = requestAnimationFrame(draw);
  };
  if (matrixRAF) cancelAnimationFrame(matrixRAF); matrixRAF = requestAnimationFrame(draw);
}
function activateHacker() { if (document.body.classList.contains('hacker')) return; document.body.classList.add('hacker'); window._repaintWall && window._repaintWall(); $('#root-btn').hidden = false; if (!reduced()) startMatrix(); toast('⛓ ACCESS GRANTED'); }
function deactivateHacker() { document.body.classList.remove('hacker'); window._repaintWall && window._repaintWall(); $('#root-btn').hidden = true; $('#secret').hidden = true; toast('systems re-secured'); }
const CMDS = {
  help: () => `<span class="t-ok">PERSONA/OS terminal v2 (zine)</span>\n<span class="t-dim">─────────────────────────────</span>\n  help          this list\n  ls            list reviewed papers\n  posts         list blog posts\n  open <name>   open a post id, or: work, zine, …\n  whoami        who you are\n  pwd           where you are\n  date          date and time\n  cat readme    about this site\n  coffee        ☕\n  clear         clear screen\n  exit          close terminal\n<span class="t-dim">─────────────────────────────\n  [ 1 command not listed — earn it ]</span>`,
  ls: () => D.papers.length ? D.papers.map((p, i) => `<span class="t-dim">${String(i + 1).padStart(2, '0')}</span>  ${esc(p.title)} <span class="t-dim">(${esc(p.year)})</span>`).join('\n') : '<span class="t-dim">[ no papers ]</span>',
  posts: () => D.posts.length ? sortedPosts().map(p => `<span class="t-dim">${esc(p.date)}</span>  ${esc(p.title)}  <span class="t-dim">[${esc(p.id)}]</span>`).join('\n') : '<span class="t-dim">[ no posts yet ]</span>',
  whoami: () => `<span class="t-ok">${esc(D.cv.name || 'unknown')}</span> — ${esc(D.cv.role || 'researcher')}`,
  pwd: () => '/home/personaos/zine', date: () => new Date().toLocaleString('en-US'),
  coffee: () => `<span class="t-ok">☕ brewing</span>\n<span class="t-dim">...........\ndone. did you like it?</span>`,
  clear: () => '__CLEAR__', exit: () => '__EXIT__', quit: () => '__EXIT__',
  'cat readme': () => `internetpersona — a retro zine\nwritten by: Ali Emre\nversion: 2.0.0-zine\nlicense: not much of one`,
  'sudo make coffee': () => `[sudo] password: ****\n<span class="t-err">ERROR: coffee pot not found in /dev</span>`,
  'sudo rm -rf /': () => `<span class="t-err">easy there, buddy.</span>`,
  'rm -rf thesis': () => `<span class="t-err">rm: cannot remove 'thesis': Too much pain attached</span>`,
  sudo: () => `<span class="t-err">this is a terminal easter egg, sudo isn't real 😌</span>`,
  'sudo unlock': () => { activateHacker(); return ACCESS_GRANTED; }, unlock: () => { activateHacker(); return ACCESS_GRANTED; },
  decrypt: () => document.body.classList.contains('hacker') ? DECRYPTED : `<span class="t-err">decrypt: nothing to decrypt — system locked.</span>`,
  lock: () => { if (!document.body.classList.contains('hacker')) return `<span class="t-dim">already locked.</span>`; deactivateHacker(); return `<span class="t-dim">re-securing... lights off.</span>`; },
  restart: () => { setTimeout(() => restartOS(), 350); return `<span class="t-dim">rebooting...</span>`; },
};
CMDS.reboot = CMDS.restart;
function runCmd(raw) {
  const out = $('#term-out'), cmd = raw.trim().toLowerCase(); if (!cmd) return;
  out.innerHTML += `\n<span class="t-dim">❯</span> ${esc(raw)}\n`;
  let res;
  const m = cmd.match(/^(open|goto|cd)\s+(.+)$/);
  if (m) { const t = m[2].trim(), post = D.posts.find(p => p.id === t);
    if (post) { res = `<span class="t-ok">opening ${esc(post.title)}</span>`; setTimeout(() => { $('#term').hidden = true; openPost(post.id); }, 250); }
    else if (Object.hasOwn(APPS, t) || t === 'zine') { res = `<span class="t-ok">opening ${t}</span>`; setTimeout(() => { $('#term').hidden = true; openApp(t); }, 250); }
    else res = `<span class="t-err">no such post or section: ${esc(t)}</span>`;
  } else res = ((Object.hasOwn(CMDS, cmd) && CMDS[cmd]) || (() => `<span class="t-err">command not found: ${esc(raw)}\ntype 'help' for a list</span>`))();
  if (res === '__CLEAR__') { out.innerHTML = ''; return; }
  if (res === '__EXIT__') { $('#term').hidden = true; return; }
  out.innerHTML += res + '\n'; out.scrollTop = out.scrollHeight;
}
function toggleTerm(force) {
  const t = $('#term'), open = force != null ? force : t.hidden; t.hidden = !open;
  if (open) { if (!$('#term-out').innerHTML) $('#term-out').innerHTML = `<span class="t-ok">PERSONA/OS terminal</span> — <span class="t-dim">type 'help' to get started</span>\n`; setTimeout(() => $('#term-in').focus(), 30); }
}
$('#term-in').addEventListener('keydown', e => { if (e.key === 'Enter') { runCmd(e.target.value); e.target.value = ''; e.preventDefault(); } });
$('#term-x').addEventListener('click', () => toggleTerm(false));
$('#secret-x').addEventListener('click', () => { $('#secret').hidden = true; });
$('#secret').addEventListener('click', e => { if (e.target.id === 'secret') $('#secret').hidden = true; });
document.addEventListener('keydown', e => {
  if (e.key === '`' && !e.ctrlKey && !e.metaKey && !paused) { const f = document.activeElement; if (f && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA') && f.id !== 'term-in') return; e.preventDefault(); toggleTerm(); }
});


/* ═══════════ OS LAYER: prefs, admin, window manager ═══════════ */
const THEMES_PLACEHOLDER = 0;
const THEMES = { warm: 'Warm parchment', moonlight: 'Moonlight', amber: 'Phosphor amber' };
let prefs = (() => { try { return JSON.parse(lsGet('zine-prefs') || 'null') || {}; } catch (e) { return {}; } })();
prefs = Object.assign({ theme: 'warm', scan: false, sounds: true }, prefs);
const savePrefs = () => lsSet('zine-prefs', JSON.stringify(prefs));
function applyPrefs() { if (!THEMES[prefs.theme]) prefs.theme = 'warm'; document.body.dataset.theme = prefs.theme; document.body.classList.toggle('scan', !!prefs.scan); window._repaintWall && window._repaintWall(); window._refreshThumbs && window._refreshThumbs(); }
const mobile = () => matchMedia('(max-width:720px)').matches;
const TB = 46; // taskbar height
let suppressUrl = false;
const setUrl = q => { try { history.pushState({}, '', location.pathname + q); } catch (e) {} };
const clearUrl = key => { if (suppressUrl) return; if (new URLSearchParams(location.search).get(key)) { try { history.replaceState({}, '', location.pathname); } catch (e) {} } };

/* ── admin: login, post editor, publish (same worker contract as the old app.js) ── */
const ADMIN_KEY = 'pl-admin-session', PW_KEY = 'pl-admin-pw', STORE_KEY = 'pl-v4', CV_KEY = 'pl-cv-v4', NOTE_KEY = 'pl-note-v4', RL_KEY = 'pl-rl-v1', POSTS_KEY = 'pl-posts-v1';
const DRAFT_KEY = 'ip-draft-v2', SECTIONS = ['papers', 'cv', 'note', 'readingList', 'posts'];
const isAdmin = () => lsGet(ADMIN_KEY) === '1';
function setAdmin(v) { try { if (v) localStorage.setItem(ADMIN_KEY, '1'); else localStorage.removeItem(ADMIN_KEY); } catch (e) {} updateBadge(); updateStart(); }
const hasDraft = () => !!lsGet(DRAFT_KEY);
function updateBadge() { const b = $('#admin-badge'); if (!b) return; const a = isAdmin(); b.className = a ? 'unlocked' : 'locked'; $('span', b).textContent = a ? (hasDraft() ? 'ADMIN •' : 'ADMIN') : 'GUEST'; b.title = a ? (hasDraft() ? 'unpublished changes · click to log out' : 'Admin: click to log out') : 'Admin login'; }
const publishedData = () => ({ papers: D.papers, cv: D.cv, note: D.note, readingList: D.readingList, work: D.work, posts: D.posts });
let remoteOk = false; // publish is refused unless data.json actually loaded (an empty payload would wipe content)
// After a publish, Pages needs ~30 s to serve the new data.json. A reload in that window loads the OLD data; publishing from it would undo the last publish. So publish stays blocked until the live file matches what was sent (or 10 min pass).
const PUB_KEY = 'ip-last-publish'; let deployPending = false;
/* Admin drafts: one entry per section, each stamped with a fingerprint of the live section it started from.
   On load a section draft is used only if the live section is still that same version; otherwise it is dropped, so a stale draft can never overwrite newer content. */
const fp = v => { const s = JSON.stringify(v == null ? null : v); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '.' + s.length; };
let remoteFp = {};
const readDraft = () => { try { const d = JSON.parse(lsGet(DRAFT_KEY) || 'null'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; } };
function saveDraft(section) {
  if (!isAdmin() || !SECTIONS.includes(section)) return;
  const d = readDraft(); d[section] = { base: remoteFp[section], data: D[section] }; lsSet(DRAFT_KEY, JSON.stringify(d)); updateBadge();
}
const savePosts = () => saveDraft('posts');
async function loadData() {
  let s = {}; remoteOk = false;
  try { const r = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { s = await r.json(); remoteOk = true; } } catch (e) {}
  // Drafts written by the old app (pre-v2 keys) are always dropped: they carry no fingerprint, so they could shadow newer live content.
  const tp = k => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };
  const oldPosts = tp(POSTS_KEY);
  [STORE_KEY, CV_KEY, NOTE_KEY, RL_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  D.papers = s.papers || []; D.cv = s.cv || {}; D.note = s.note || ''; D.readingList = s.readingList || []; D.posts = s.posts || []; D.work = s.work || [];
  remoteFp = {}; SECTIONS.forEach(k => { remoteFp[k] = fp(D[k]); });
  deployPending = false;
  try { const lp = JSON.parse(lsGet(PUB_KEY) || 'null'); if (lp && remoteOk) { if (fp(publishedData()) === lp.fp || Date.now() - lp.at > 600000) localStorage.removeItem(PUB_KEY); else deployPending = true; } } catch (e) {}
  if (!isAdmin() || !remoteOk) return;
  // one-time carry-over of a posts draft saved by the previous version of this file (same base assumption it already used)
  if (Array.isArray(oldPosts) && oldPosts.length && !readDraft().posts) { const d = readDraft(); d.posts = { base: remoteFp.posts, data: oldPosts }; lsSet(DRAFT_KEY, JSON.stringify(d)); }
  try { localStorage.removeItem(POSTS_KEY); } catch (e) {}
  const d = readDraft(); let dropped = 0;
  SECTIONS.forEach(k => { const e = d[k]; if (!e) return; if (e.base === remoteFp[k]) D[k] = e.data; else { delete d[k]; dropped++; } });
  if (Object.keys(d).length) lsSet(DRAFT_KEY, JSON.stringify(d)); else { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }
  if (dropped) setTimeout(() => toast('live data changed since your draft, ' + dropped + ' section draft(s) dropped'), 400);
}
function toggleAdminLogin() {
  if (isAdmin()) themedConfirm('Log out from admin?', async () => { setAdmin(false); try { sessionStorage.removeItem(PW_KEY); } catch (e) {} await loadData(); renderAll(); toast('Logged out'); }, { confirmLabel: 'Log out', danger: false });
  else openLogin();
}
function openLogin() {
  openWin({ id: 'login', title: 'admin login', icon: 'about', dialog: true, build: b => {
    b.innerHTML = `<div class="frm"><label for="login-pass">Password</label><input id="login-pass" type="password" placeholder="enter password…" autocomplete="current-password"><div id="login-err" class="frm-err" role="alert"></div>
      <div class="frm-row"><button class="btn" id="login-btn" type="button">Login</button><button class="btn btn--ghost" type="button" data-close="login">Cancel</button></div><small>Verified server-side by the publish worker. Wrong attempts are rate-limited.</small></div>`;
    const pw = $('#login-pass', b); pw.addEventListener('keydown', e => { if (e.key === 'Enter') submitLogin(); });
    $('#login-btn', b).addEventListener('click', submitLogin); setTimeout(() => pw.focus(), 60);
  } });
}
async function submitLogin() {
  const pass = $('#login-pass')?.value || '', err = $('#login-err'), btn = $('#login-btn');
  if (err) err.textContent = '';
  if (!pass) { if (err) err.textContent = 'Enter a password.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await fetch(WORKER_URL + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (r.ok) { try { sessionStorage.setItem(PW_KEY, pass); } catch (e) {} setAdmin(true); closeWin('login'); await loadData(); renderAll(); toast('Admin verified ✓'); }
    else if (r.status === 401) { if (err) err.textContent = 'Incorrect password.'; }
    else if (err) err.textContent = 'Worker error: ' + r.status;
  } catch (e) { if (err) err.textContent = 'Cannot reach worker.'; }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Login'; } }
}
function publishToWorker() {
  let pass = ''; try { pass = sessionStorage.getItem(PW_KEY) || ''; } catch (e) {}
  if (!pass) { toast('Session expired — log in again'); setAdmin(false); openLogin(); return; }
  themedPrompt('Commit message:', 'Update via personaOS', msg => doPublish(msg, pass));
}
async function doPublish(msg, pass) {
  if (!remoteOk) { toast("data.json didn't load, reload the page before publishing"); return; }
  if (deployPending) { toast('the last publish is still deploying, reload in a minute'); return; }
  toast('Publishing…');
  try {
    const r = await fetch(WORKER_URL + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass, data: publishedData(), message: msg }) });
    if (r.ok) { [STORE_KEY, CV_KEY, NOTE_KEY, RL_KEY, POSTS_KEY, DRAFT_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); SECTIONS.forEach(k => { remoteFp[k] = fp(D[k]); }); lsSet(PUB_KEY, JSON.stringify({ at: Date.now(), fp: fp(publishedData()) })); renderAll(); toast('committed ✓ deploying…'); pollDeploy(publishedData()); }
    else if (r.status === 401) { try { sessionStorage.removeItem(PW_KEY); } catch (e) {} setAdmin(false); toast('Auth expired — log in again'); openLogin(); }
    else { const e = await r.json().catch(() => ({})); toast('Publish failed: ' + (e.error || r.status)); }
  } catch (e) { toast('Network error'); }
}
async function pollDeploy(expected, left = 20) {
  if (left <= 0) { toast('Committed ✓ — still deploying, check back shortly'); return; }
  await new Promise(r => setTimeout(r, 3000));
  try { const live = await (await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' })).json(); if (JSON.stringify(live) === JSON.stringify(expected)) { try { localStorage.removeItem(PUB_KEY); } catch (e) {} deployPending = false; toast('deployed ✓ live now'); return; } } catch (e) {}
  pollDeploy(expected, left - 1);
}
function postSlug(title) {
  const base = (String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)) || 'post';
  let s = base, i = 2; while (D.posts.some(p => p.id === s)) s = `${base}-${i++}`; return s;
}
function openPostEditor(id) {
  if (!isAdmin()) { toast('Admin only'); return; }
  const p = id ? D.posts.find(x => x.id === id) : null;
  openWin({ id: 'post-editor', title: p ? 'edit_post.md' : 'new_post.md', icon: 'posts', width: 560, height: 600, build: b => {
    b.innerHTML = `<div class="frm"><label for="pe-title">Title *</label><input id="pe-title" value="${esc(p?.title || '')}">
      <label for="pe-date">Date</label><input id="pe-date" type="date" value="${esc(p?.date || new Date().toISOString().slice(0, 10))}">
      <label for="pe-summary">Summary (one line)</label><input id="pe-summary" value="${esc(p?.summary || '')}">
      <label for="pe-body">Body <small>(## heading · - list · **bold** · [text](https://…))</small></label><textarea id="pe-body" rows="14">${esc(p?.body || '')}</textarea>
      <div class="frm-row"><button class="btn" type="button" id="pe-save">Save draft</button><button class="btn btn--ghost" type="button" data-close="post-editor">Cancel</button></div></div>`;
    $('#pe-save', b).addEventListener('click', () => savePostEditor(p?.id || ''));
  } });
}
function savePostEditor(id) {
  const v = k => $('#' + k)?.value ?? '', title = v('pe-title').trim(); if (!title) { toast('Title is required!'); return; }
  const f = { title, date: v('pe-date').trim() || new Date().toISOString().slice(0, 10), summary: v('pe-summary').trim(), body: v('pe-body') };
  let p = id ? D.posts.find(x => x.id === id) : null;
  if (p) Object.assign(p, f); else { p = { id: postSlug(title), ...f }; D.posts.push(p); }
  savePosts(); refreshMounts(); closeWin('post-editor'); if (wins.reader) renderPost(p); else if (!$('#z-reader').hidden) renderPost(p, true); toast('Saved draft ✓ — publish to go live');
}
function deletePost(id) { themedConfirm('Delete this post?', () => { D.posts = D.posts.filter(x => x.id !== id); savePosts(); closeWin('reader'); if (!$('#z-reader').hidden) zineHome(); refreshMounts(); }, { confirmLabel: 'Delete' }); }
function themedConfirm(msg, ok, { confirmLabel = 'OK', danger = true } = {}) {
  const id = 'confirm-' + Date.now();
  openWin({ id, title: 'confirm', icon: 'about', dialog: true, build: b => {
    b.innerHTML = `<div class="frm"><p>${esc(msg)}</p><div class="frm-row"><button class="btn" id="dlg-yes" type="button">${esc(confirmLabel)}</button><button class="btn btn--ghost" type="button" data-close="${id}">Cancel</button></div></div>`;
    $('#dlg-yes', b).addEventListener('click', () => { closeWin(id); ok(); }); setTimeout(() => $('#dlg-yes', b)?.focus(), 60);
  } });
}
function themedPrompt(msg, def, ok) {
  const id = 'prompt-' + Date.now();
  openWin({ id, title: 'input', icon: 'about', dialog: true, build: b => {
    b.innerHTML = `<div class="frm"><label for="dlg-in">${esc(msg)}</label><input id="dlg-in" value="${esc(def || '')}"><div class="frm-row"><button class="btn" id="dlg-ok" type="button">OK</button><button class="btn btn--ghost" type="button" data-close="${id}">Cancel</button></div></div>`;
    const i = $('#dlg-in', b); $('#dlg-ok', b).addEventListener('click', () => { const v = i.value; closeWin(id); ok(v); });
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#dlg-ok', b).click(); } }); setTimeout(() => { i.focus(); i.select(); }, 60);
  } });
}

/* ── window manager (draggable windows on desktop, full-screen sheets on mobile) ── */
const wins = {}; let zTop = 200;
function openWin(o) {
  const id = o.id;
  if (wins[id]) { if (wins[id].el.classList.contains('min')) minWin(id, false); focusWin(id); return wins[id]; }
  const el = document.createElement('div');
  el.className = 'win' + (o.dialog ? ' win--dialog' : '') + (o.cls ? ' ' + o.cls : ''); el.id = 'win-' + id;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title);
  el.innerHTML = `<div class="tbar"><button type="button" class="tb-back" data-tb="close">◀ back</button><img src="assets/icons/${o.icon || 'posts'}.png" alt="" width="24" height="24"><span class="ttl"></span><span class="tbtns">${o.dialog ? '' : '<button type="button" data-tb="min" aria-label="Minimize" title="Minimize">─</button><button type="button" data-tb="max" aria-label="Maximize" title="Maximize">□</button>'}<button type="button" data-tb="close" aria-label="Close" title="Close">✕</button></span></div>${o.progress ? '<div class="wprog"><i></i></div>' : ''}<div class="wbody"></div>`;
  $('.ttl', el).textContent = o.title;
  document.body.appendChild(el);
  const w = { el, o, body: $('.wbody', el) }; wins[id] = w;
  if (o.dialog) { el.style.width = 'min(420px,92vw)'; $('#scrim').hidden = false; }
  else {
    const W = Math.min(o.width || 560, innerWidth - 24), H = Math.min(o.height || 520, innerHeight - TB - 24, Math.max(320, Math.round((innerHeight - TB) * .72))), n = Math.max(0, Object.values(wins).filter(x => !x.o.dialog).length - 1) % 7;
    const minL = innerWidth > 900 ? 150 : 8; let left = minL + 20 + n * 44, top = 22 + n * 38;
    if (o.side) { left = Math.max(minL, innerWidth - W - 36 - (n % 3) * 26); top = 26 + (n % 3) * 30; }
    if (left + W > innerWidth - 8) left = Math.max(minL, innerWidth - W - 12 - (n % 3) * 20); if (top + H > innerHeight - TB - 8) top = Math.max(8, innerHeight - TB - H - 8);
    Object.assign(el.style, { width: W + 'px', height: H + 'px', left: left + 'px', top: top + 'px' });
  }
  const tbar = $('.tbar', el);
  tbar.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || mobile() || o.dialog || el.classList.contains('max')) return;
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; tbar.setPointerCapture(e.pointerId);
    const mv = ev => { el.style.left = Math.min(innerWidth - 90, Math.max(90 - r.width, ev.clientX - dx)) + 'px'; el.style.top = Math.min(innerHeight - TB - 36, Math.max(0, ev.clientY - dy)) + 'px'; };
    const up = () => { tbar.removeEventListener('pointermove', mv); tbar.removeEventListener('pointerup', up); };
    tbar.addEventListener('pointermove', mv); tbar.addEventListener('pointerup', up);
  });
  tbar.addEventListener('dblclick', e => { if (!e.target.closest('button') && !o.dialog && !mobile()) el.classList.toggle('max'); });
  el.addEventListener('pointerdown', () => focusWin(id));
  el.addEventListener('click', e => { const t = e.target.closest('[data-tb]'); if (!t) return; const a = t.dataset.tb; if (a === 'close') closeWin(id); else if (a === 'min') minWin(id, true); else if (a === 'max') el.classList.toggle('max'); });
  if (o.progress) w.body.addEventListener('scroll', () => { const b = w.body, p = b.scrollTop / Math.max(1, b.scrollHeight - b.clientHeight); $('.wprog i', el).style.width = (Math.round(p * 20) * 5) + '%'; }, { passive: true });
  if (!o.dialog) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tb-btn wbtn'; b.dataset.win = id;
    b.innerHTML = `<img src="assets/icons/${o.icon || 'posts'}.png" alt="" width="20" height="20"><span></span>`; $('span', b).textContent = o.title;
    b.addEventListener('click', () => { const ww = wins[id]; if (!ww) return; if (ww.el.classList.contains('min')) { minWin(id, false); focusWin(id); } else if (ww.el.classList.contains('focused')) minWin(id, true); else focusWin(id); });
    $('#tb-wins').appendChild(b);
  }
  o.build && o.build(w.body, w);
  if (!reduced()) { el.classList.add('opening'); el.addEventListener('animationend', () => el.classList.remove('opening'), { once: true }); }
  playSound('open'); focusWin(id); syncLock(); return w;
}
function setWinTitle(id, t) { const w = wins[id]; if (!w) return; $('.ttl', w.el).textContent = t; const b = $(`.tb-btn[data-win="${id}"] span`); if (b) b.textContent = t; w.el.setAttribute('aria-label', t); }
function focusWin(id) { const w = wins[id]; if (!w) return; if (++zTop > 380) { Object.keys(wins).sort((p, q) => (+wins[p].el.style.zIndex || 0) - (+wins[q].el.style.zIndex || 0)).forEach((k, i) => { wins[k].el.style.zIndex = 200 + i; }); zTop = 200 + Object.keys(wins).length; } w.el.style.zIndex = zTop; document.querySelectorAll('.win').forEach(x => x.classList.toggle('focused', x === w.el)); document.querySelectorAll('.tb-btn.wbtn').forEach(b => b.classList.toggle('active', b.dataset.win === id)); }
function minWin(id, on) { const w = wins[id]; if (!w) return; if (on) playSound('min'); w.el.classList.toggle('min', on); const b = $(`.tb-btn[data-win="${id}"]`); if (b) { b.classList.toggle('mini', on); if (on) b.classList.remove('active'); } }
function closeWin(id, silent) {
  const w = wins[id]; if (!w) return;
  const prev = suppressUrl; if (silent) suppressUrl = true;
  w.o.onClose && w.o.onClose(); suppressUrl = prev;
  // bookkeeping is synchronous (route/restart rely on it); only the element lingers for the close animation
  delete wins[id]; $(`.tb-btn[data-win="${id}"]`)?.remove(); w.el.removeAttribute('id'); w.el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  if (silent || reduced() || w.el.classList.contains('min')) w.el.remove();
  else { playSound('close'); w.el.classList.remove('opening', 'focused'); w.el.classList.add('closing'); setTimeout(() => w.el.remove(), 190); }
  if (!Object.values(wins).some(x => x.o.dialog)) $('#scrim').hidden = true;
  const t = topWin(); if (t) focusWin(t); syncLock();
}
function topWin() { let best = null, z = -1; Object.keys(wins).forEach(id => { const e = wins[id].el; if (!e.classList.contains('min') && (+e.style.zIndex || 0) > z) { z = +e.style.zIndex || 0; best = id; } }); return best; }
function closeAllWins() { Object.keys(wins).forEach(id => closeWin(id, true)); }

function openPrefs() {
  openWin({ id: 'prefs', title: 'preferences.cfg', icon: 'about', width: 460, height: 480, build: b => {
    b.innerHTML = `<div class="frm prefs"><fieldset><legend>Wallpaper</legend><div class="wp-grid">${WALLS.map(n => `<label class="wp-opt"><input type="radio" name="wp" value="${n}"><span style="background-image:url(assets/wallpapers/${n}.webp)"></span><b>${n}</b></label>`).join('')}</div></fieldset>
      <fieldset><legend>Theme</legend>${Object.keys(THEMES).map(k => `<label class="opt"><input type="radio" name="theme" value="${k}"> ${THEMES[k]}</label>`).join('')}</fieldset>
      <fieldset><legend>Display</legend><label class="opt"><input type="checkbox" id="pf-scan"> CRT scanlines</label><label class="opt"><input type="checkbox" id="pf-snd"> Sounds</label></fieldset>
      <small>Saved in this browser only.</small></div>`;
    const cur = lsGet('zine-wall') || 'waves'; $(`[name=wp][value="${cur}"]`, b).checked = true; $(`[name=theme][value="${prefs.theme}"]`, b).checked = true; $('#pf-scan', b).checked = !!prefs.scan; $('#pf-snd', b).checked = !!prefs.sounds; window._refreshThumbs && window._refreshThumbs();
    b.addEventListener('change', e => { const t = e.target; if (t.name === 'wp') window._setWall && window._setWall(t.value); else if (t.name === 'theme') { prefs.theme = t.value; savePrefs(); applyPrefs(); } else if (t.id === 'pf-scan') { prefs.scan = t.checked; savePrefs(); applyPrefs(); } else if (t.id === 'pf-snd') { prefs.sounds = t.checked; savePrefs(); if (t.checked) playSound('click'); } });
  } });
}
/* ═══════════ OS: wallpaper, intro, apps, zine switch, start menu, pet ═══════════ */
const DOC_TITLE = 'internetpersona — Ali Emre Aydın';
const NAME_LINE = 'ali emre aydın', TAG_LINE = 'machine learning by day, things i build at 2am by night.';
const TAGLINE = NAME_LINE + '. ' + TAG_LINE;
const WALLS = ['waves', 'ribbons', 'dunes', 'mesh'];
/* wallpapers are ~24-colour dithered pixel art in the warm palette; other themes remap each colour by brightness,
   warm tones onto the theme's main ramp and teal tones onto its second ramp, so composition and dither stay identical */
const WALL_RAMPS = {
  moonlight: { a: ['#0b0a16', '#1c1934', '#3a2c78', '#6a4fc8', '#a58ae8', '#e4def8'], b: ['#0a1026', '#16295c', '#2f5aa8', '#5c8ad8', '#a8c4f0'], glow: '160,130,240' },
  amber: { a: ['#070400', '#241400', '#5a3600', '#a86e00', '#ffaa00', '#ffd27a'], b: ['#050300', '#1a0f00', '#442800', '#7a5000', '#c08000'], glow: '255,170,0' },
  hacker: { a: ['#000600', '#002000', '#005a1c', '#00a833', '#00ff41', '#b0ffc4'], b: ['#000400', '#001806', '#00441a', '#00802c', '#30d860'], glow: '0,255,65' },
};
const wallTheme = () => (document.body.classList.contains('hacker') ? 'hacker' : (WALL_RAMPS[prefs.theme] ? prefs.theme : 'warm'));
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function rampAt(stops, t) { const c = stops.map(hexRgb), x = Math.min(1, Math.max(0, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(x)), f = x - i; return c[i].map((v, k) => Math.round(v + (c[i + 1][k] - v) * f)); }
const recolorCache = new Map();
function recolorWall(img, theme) {
  const key = img.src + '|' + theme; if (recolorCache.has(key)) return recolorCache.get(key);
  const R = WALL_RAMPS[theme], c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const id = x.getImageData(0, 0, c.width, c.height), d = id.data;
  const lum = (r, g, b) => .299 * r + .587 * g + .114 * b; let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const l = lum(d[i], d[i + 1], d[i + 2]); if (l < lo) lo = l; if (l > hi) hi = l; }
  const map = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; let o = map.get(k);
    if (!o) { const cool = d[i + 2] > d[i] + 6, t = (lum(d[i], d[i + 1], d[i + 2]) - lo) / Math.max(1, hi - lo); o = rampAt(cool ? R.b : R.a, cool ? t * 1.15 : t); map.set(k, o); }
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
  }
  x.putImageData(id, 0, 0); recolorCache.set(key, c); return c;
}
function wallSource(img) { const t = wallTheme(); return t === 'warm' ? img : recolorWall(img, t); }
function osArt() {
  // Static wallpaper (drawn once per change) + a pointer glow that only repaints while the glow is still easing. No continuous loop.
  const c = $('#art'), ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const imgs = {}; let idx = Math.max(0, WALLS.indexOf(lsGet('zine-wall') || 'waves')), mx = .7, my = .4, tmx = .7, tmy = .4, raf = 0;
  const W = c.width, H = c.height;
  const load = n => imgs[n] || (imgs[n] = Object.assign(new Image(), { src: `assets/wallpapers/${n}.webp`, onload: () => { draw(); window._refreshThumbs && window._refreshThumbs(); } }));
  function draw() {
    const im = imgs[WALLS[idx]]; if (!im || !im.complete || !im.naturalWidth) return;
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(wallSource(im), 0, 0, W, H);
    if (reduced()) return;
    const glow = (WALL_RAMPS[wallTheme()] || { glow: '232,160,64' }).glow;
    ctx.globalCompositeOperation = 'lighter';
    const lx = mx * W, ly = my * H, g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 90); g.addColorStop(0, `rgba(${glow},.26)`); g.addColorStop(1, `rgba(${glow},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  function ease() { raf = 0; if (paused || booting()) return; mx += (tmx - mx) * .18; my += (tmy - my) * .18; draw(); if (Math.abs(tmx - mx) + Math.abs(tmy - my) > .004) raf = requestAnimationFrame(ease); }
  load(WALLS[idx]); setTimeout(() => WALLS.forEach(load), 1500);
  $('#os').addEventListener('pointermove', e => { if (reduced() || paused || booting()) return; tmx = e.clientX / innerWidth; tmy = e.clientY / innerHeight; if (!raf) raf = requestAnimationFrame(ease); }, { passive: true });
  window._setWall = n => { idx = Math.max(0, WALLS.indexOf(n)); lsSet('zine-wall', WALLS[idx]); load(WALLS[idx]); draw(); };
  window._repaintWall = () => draw();
  // preference thumbnails follow the theme too
  window._wallThumb = n => { const im = imgs[n]; if (!im || !im.complete || !im.naturalWidth || wallTheme() === 'warm') return `assets/wallpapers/${n}.webp`; return recolorWall(im, wallTheme()).toDataURL('image/png'); };
  window._refreshThumbs = () => document.querySelectorAll('.wp-opt input[name=wp]').forEach(i => { const sp = i.nextElementSibling; if (sp) sp.style.backgroundImage = `url("${window._wallThumb(i.value)}")`; });
}
function wordmarkHop(root) {
  root.querySelectorAll('span').forEach(s => { if (s.children.length) return; s.innerHTML = [...s.textContent].map(c => `<span class="ch" aria-hidden="true">${c}</span>`).join(''); });
  root.addEventListener('pointerover', e => { const c = e.target.closest('.ch'); if (!c || c.classList.contains('hop')) return; c.classList.add('hop'); setTimeout(() => c.classList.remove('hop'), 220); });
}
/* intro: transform/opacity only, ~3.7 s (owner: 2.2 s felt too fast). The overlay is static markup in index.html so it paints on the first frame. */
const booting = () => document.documentElement.classList.contains('booting');
function bootMarkup() {
  let i = 0; const L = (t) => [...t].map(ch => `<i style="--i:${i++}" aria-hidden="true">${ch}</i>`).join('');
  return `<div class="boot-in"><h1 id="boot-wm" aria-label="internetpersona"><span class="wm-a">${L('internet')}</span><span class="wm-b">${L('persona')}</span></h1><p id="boot-line" aria-label="${esc(TAGLINE)}">${(() => { let k = 0; const W = t => t.split(' ').map(w => `<i style="--i:${k++}" aria-hidden="true">${esc(w)}</i>`).join(' '); return W(NAME_LINE) + '<br>' + W(TAG_LINE); })()}</p></div>`;
}
function runIntro() {
  const root = document.documentElement; let el = $('#boot');
  if (reduced() || root.classList.contains('no-intro')) { el && el.remove(); root.classList.remove('booting'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'boot'; el.innerHTML = bootMarkup(); document.body.prepend(el); }
  el.classList.remove('out', 'go'); root.classList.add('booting'); window.scrollTo(0, 0);
  const timers = []; let done = false; const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); document.removeEventListener('keydown', finish); el.removeEventListener('pointerdown', finish);
    el.classList.add('out'); root.classList.remove('booting'); $('#os').classList.add('icons-in'); later(() => { el.remove(); $('#os').classList.remove('icons-in'); }, 650); };
  el.addEventListener('pointerdown', finish); document.addEventListener('keydown', finish);
  const go = () => { if (done) return; el.classList.add('go'); later(finish, 3300); };
  const fonts = document.fonts && document.fonts.load ? Promise.race([Promise.all([document.fonts.load('700 48px "Pixelify Sans"'), document.fonts.load('400 20px Literata')]), new Promise(r => setTimeout(r, 700))]) : Promise.resolve();
  fonts.then(go, go);
}

/* ── apps (desktop icons open windows) ── */
function openApp(id) {
  if (id === 'terminal') { toggleTerm(true); return; }
  if (id === 'zine') { scrollToZine(); return; }
  const a = APPS[id]; if (!a) return;
  openWin({ id: 'app-' + id, title: a.file, icon: id, width: a.w, height: a.h, build: b => { b.classList.add('app'); mount(id, b, 'win'); } });
}
/* ── zine = the page below the fixed OS; it slides up over it as you scroll ── */
let cover = 0, paused = false, covTick = false, playT = 0;
const zineTop = () => $('#zine').offsetTop;
const smooth = () => (reduced() ? 'auto' : 'smooth');
function scrollToZine(instant) { window.scrollTo({ top: zineTop(), behavior: instant ? 'auto' : smooth() }); }
function scrollToOS(instant) { window.scrollTo({ top: 0, behavior: instant ? 'auto' : smooth() }); }
function showZineHome() { $('#z-home').hidden = false; $('#z-reader').hidden = true; document.title = DOC_TITLE; }
function zineHome(push = true) { showZineHome(); const el = $('#z-posts'); window.scrollTo(0, Math.max(zineTop(), el.getBoundingClientRect().top + scrollY - 8)); if (push) syncViewUrl(true); }
function syncViewUrl(force) {
  const q = new URLSearchParams(location.search); if (q.get('post') && !q.get('view')) return; if (q.get('paper')) return;
  const want = paused ? '?view=zine' : ''; if (force || location.search !== want) { try { history.replaceState({}, '', location.pathname + want); } catch (e) {} }
}
function updateCover(initial) {
  covTick = false; const top = $('#zine').getBoundingClientRect().top; cover = Math.min(1, Math.max(0, 1 - top / innerHeight));
  $('#dim').style.opacity = (cover * .8).toFixed(3);
  const g = $('#glyph'), a = Math.min(1, Math.max(0, (cover - .06) / .2)) * (cover > .9 ? Math.max(0, 1 - (cover - .9) / .1) : 1);
  g.style.opacity = a.toFixed(3); g.style.transform = `translate(-50%, calc(-50% + ${Math.round(innerHeight * (1 - cover) / 2)}px))`;
  document.body.classList.toggle('covered', cover > .995);
  const np = cover > .3; if (np !== paused) setPaused(np, initial);
}
function setPaused(v, initial) {
  paused = v; document.body.classList.toggle('paused', v);
  if (v) { closeStart(false); $('#term').hidden = true; $('#secret').hidden = true; if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.win,#taskbar,#os')) document.activeElement.blur(); }
  else { tick(); if (!initial) flashPlay(); }
  syncViewUrl();
}
function flashPlay() {
  const g = $('#glyph'); g.classList.add('play'); clearTimeout(playT);
  g.style.opacity = '1'; playT = setTimeout(() => { g.classList.remove("play"); if (cover < .06) g.style.opacity = "0"; }, 800);
}
addEventListener('scroll', () => { if (!covTick) { covTick = true; requestAnimationFrame(() => updateCover()); } }, { passive: true });
addEventListener('resize', () => updateCover());

/* ── start menu ── */
function buildStart() {
  const it = id => `<button type="button" role="menuitem" class="sm-item" data-app="${id}"><img src="assets/icons/${id}.png" alt="" width="28" height="28"><span>${APPS[id].label}</span></button>`;
  $('#start-menu').innerHTML = `<div class="sm-strip" aria-hidden="true"><span>START</span></div><div class="sm-items">${Object.keys(APPS).map(it).join('')}<hr>
    <button type="button" role="menuitem" class="sm-item" data-app="zine"><img src="assets/icons/zine.png" alt="" width="28" height="28"><span>Read as zine</span></button>
    <button type="button" role="menuitem" class="sm-item" data-app="terminal"><img src="assets/icons/terminal.png" alt="" width="28" height="28"><span>Terminal</span></button>
    <button type="button" role="menuitem" class="sm-item" data-sm="prefs"><span class="sm-g">⚙</span><span>Preferences</span></button>
    <button type="button" role="menuitem" class="sm-item" data-sm="restart"><span class="sm-g">⏻</span><span>Restart</span></button>
    <button type="button" role="menuitem" class="sm-item" data-sm="publish" id="sm-publish" hidden><span class="sm-g">⇪</span><span>Publish changes</span></button>
    <button type="button" role="menuitem" class="sm-item" data-sm="admin"><span class="sm-g">●</span><span id="sm-admin">Admin login</span></button></div>`;
  $('#tb-quick').innerHTML = ['posts', 'work', 'reviews', 'about'].map(id => `<button type="button" class="tb-btn q" data-app="${id}" aria-label="${id}"><img src="assets/icons/${id}.png" alt="" width="24" height="24"></button>`).join('');
  updateStart();
}
function updateStart() { const a = $('#sm-admin'); if (a) a.textContent = isAdmin() ? 'Log out (admin)' : 'Admin login'; const p = $('#sm-publish'); if (p) p.hidden = !isAdmin(); }
function openStart() { const m = $('#start-menu'); m.hidden = false; playSound('click'); $('#start-btn').setAttribute('aria-expanded', 'true'); updateStart(); $('.sm-item', m).focus(); }
function closeStart(refocus = true) { const m = $('#start-menu'); if (m.hidden) return; m.hidden = true; $('#start-btn').setAttribute('aria-expanded', 'false'); if (refocus) $('#start-btn').focus(); }
function startAction(a) { closeStart(false); if (a === 'prefs') openPrefs(); else if (a === 'restart') restartOS(); else if (a === 'admin') toggleAdminLogin(); else if (a === 'publish') publishToWorker(); }
function restartOS() {
  closeAllWins(); closeStart(false); $('#term').hidden = true; scrollToOS(true); showZineHome();
  if (!reduced()) { const f = $('#crt-flash'); f.hidden = false; f.className = ''; void f.offsetWidth; f.className = 'go'; setTimeout(() => { f.hidden = true; f.className = ''; }, 1100); setTimeout(runIntro, 900); }
}

/* ── desktop: draggable sticky note ── */
function initDesktop() {
  const st = $('#sticky'), os = $('#os'); let ox = 0, oy = 0;
  st.addEventListener('pointerdown', e => { if (mobile() || e.target.closest('button')) return; const r = st.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; st.setPointerCapture(e.pointerId); st.classList.add('drag');
    const mv = ev => { st.style.right = 'auto'; st.style.left = Math.min(innerWidth - 80, Math.max(0, ev.clientX - ox)) + 'px'; st.style.top = Math.min(innerHeight - TB - 60, Math.max(0, ev.clientY - oy)) + 'px'; };
    const up = () => { st.classList.remove('drag'); st.removeEventListener('pointermove', mv); st.removeEventListener('pointerup', up); }; st.addEventListener('pointermove', mv); st.addEventListener('pointerup', up); });
  st.addEventListener('keydown', e => { const k = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key]; if (!k) return; e.preventDefault(); const r = st.getBoundingClientRect(); st.style.right = 'auto'; st.style.left = (r.left + k[0]) + 'px'; st.style.top = (r.top + k[1]) + 'px'; });
}
function renderSticky() {
  const paras = String(D.note || '').trim().split(/\n{2,}/), note = (paras.length > 1 ? paras.slice(1) : paras).join('\n\n').trim();
  $('#sticky-text').textContent = note; $('#sticky-edit').hidden = !isAdmin(); $('#sticky').hidden = !note && !isAdmin();
}

/* ── desktop pet: tiny teal blob, walks along the taskbar edge ── */
let petTick = 0;
function drawAboutPets() { document.querySelectorAll('.about-pet').forEach(c => { const x = c.getContext('2d'); petDraw(x, PET_FRAMES.sit[(petTick >> 3) % 2]); }); }
function initPet() {
  const cv = $('#pet'), ctx = cv.getContext('2d'), S = 3;
  cv.style.width = 16 * S + 'px'; cv.style.height = 20 * S + 'px';
  let x = Math.max(40, innerWidth * .6), dir = -1, state = 'walk', until = 40, hop = 0, last = Date.now(), frame = PET_FRAMES.sit[0], drawn = null, placed = '';
  const place = () => { const t = `translate3d(${Math.round(x)}px,0,0) scaleX(${dir < 0 ? -1 : 1})`; if (t !== placed) { cv.style.transform = t; placed = t; } };
  const paint = () => { if (frame !== drawn) { drawn = frame; petDraw(ctx, frame); } };
  paint(); place();
  const act = () => { last = Date.now(); if (state === 'sleep') { state = 'sit'; until = petTick + 14; } };
  ['pointermove', 'keydown', 'pointerdown'].forEach(ev => document.addEventListener(ev, act, { passive: true }));
  cv.addEventListener('click', () => { if (paused) return; if (reduced()) { frame = PET_FRAMES.hop[0]; paint(); setTimeout(() => { frame = PET_FRAMES.sit[0]; paint(); }, 900); return; } hop = 8; act(); });
  if (reduced()) return;
  setInterval(() => { // ~7.7 fps; frozen while the zine covers the OS, during the intro, or when the tab is hidden
    if (paused || document.hidden || booting()) return; petTick++;
    const maxX = innerWidth - 16 * S - 6;
    if (hop > 0) { frame = PET_FRAMES.hop[3 - Math.floor((hop - 1) / 2)]; hop--; if (!hop) until = petTick + 10; }
    else {
      if (Date.now() - last > 20000 && state !== 'sleep') state = 'sleep';
      if (state !== 'sleep' && petTick >= until) { const r = Math.random(); state = r < .55 ? 'walk' : r < .8 ? 'sit' : 'idle'; until = petTick + (state === 'walk' ? 40 + Math.random() * 50 : 18 + Math.random() * 30); if (state === 'walk' && Math.random() < .4) dir *= -1; }
      if (state === 'walk') { x += dir * 3; if (x < 6) { x = 6; dir = 1; } else if (x > maxX) { x = maxX; dir = -1; } frame = PET_FRAMES.walk[(petTick >> 1) % 4]; }
      else if (state === 'idle') frame = PET_FRAMES.idle[petTick % 16 < 2 ? 1 : 0];
      else if (state === 'sit') frame = PET_FRAMES.sit[(petTick >> 3) % 2];
      else frame = PET_FRAMES.sleep[(petTick >> 4) % 2];
    }
    paint(); place(); if (petTick % 8 === 0) drawAboutPets();
  }, 130);
}

/* wheel over a window scrolls that window only; page scroll happens over the empty desktop */
document.addEventListener('wheel', e => {
  const w = e.target.closest && e.target.closest('.win'); if (!w) return; const dy = e.deltaY;
  for (let el = e.target; el && el !== w.parentNode; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) { const oy = getComputedStyle(el).overflowY; if ((oy === 'auto' || oy === 'scroll') && ((dy < 0 && el.scrollTop > 0) || (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1))) return; }
  }
  e.preventDefault();
}, { passive: false });
const syncLock = () => document.documentElement.classList.toggle('lock', mobile() && Object.values(wins).some(x => !x.o.dialog));

/* ── global interactions ── */
function renderAll() { refreshMounts(); renderSticky(); updateBadge(); updateStart(); }
document.addEventListener('click', e => {
  const t = e.target;
  if (!t.closest('#start-menu,#start-btn')) closeStart(false);
  const a = t.closest('a');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank' && a.dataset.post) { e.preventDefault(); openPost(a.dataset.post, true, !!a.closest('#zine')); return; }
  const d = t.closest('[data-close]'); if (d) { closeWin(d.dataset.close); return; }
  const ap = t.closest('[data-app]'); if (ap) { closeStart(false); if (ap.classList.contains('d-icon')) { document.querySelectorAll('.d-icon').forEach(x => x.classList.toggle('sel', x === ap)); } openApp(ap.dataset.app); return; }
  const sm = t.closest('[data-sm]'); if (sm) { startAction(sm.dataset.sm); return; }
  if (t.closest('#root-btn')) { $('#secret-pre').textContent = SECRET_NOTE; $('#secret').hidden = false; return; }
  const ac = t.closest('[data-act]'); if (!ac) { if (!t.closest('.d-icon')) document.querySelectorAll('.d-icon.sel').forEach(x => x.classList.remove('sel')); return; } const id = ac.dataset.id;
  ({ 'open-notes': () => openNotes(id), 'new-post': () => openPostEditor(), 'edit-post': () => openPostEditor(id), 'delete-post': () => deletePost(id), 'publish': publishToWorker, 'gb-send': () => submitGuestbook(ac), 'zine-home': () => zineHome(),
     'add-paper': openAddPaper, 'ap-fetch': autofillPaper, 'ap-save': submitAddPaper, 'rate': () => setRating(id, +ac.dataset.n), 'tag-x': () => removeTag(id, ac.dataset.i),
     'paper-save': () => savePaper(id), 'paper-del': () => deletePaper(id), 'rl-add': () => addReading(ac), 'rl-del': () => deleteReading(id),
     'note-edit': openNoteEditor, 'note-save': saveNote, 'cv-edit': openCvEditor, 'cv-save': saveCv,
     'copy-link': () => { const u = location.origin + location.pathname + '?post=' + encodeURIComponent(id); try { navigator.clipboard.writeText(u); toast('link copied ✓'); } catch (er) { toast(u); } } }[ac.dataset.act] || (() => {}))();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; const t = e.target;
  if (t.matches && t.matches('.tag-in')) { e.preventDefault(); addTag(t.dataset.id, t.value); }
  else if (t.matches && t.matches('.rl-title,.rl-link')) { e.preventDefault(); addReading(t); }
});
$('#z-up').addEventListener('click', () => scrollToOS());
$('#start-btn').addEventListener('click', () => ($('#start-menu').hidden ? openStart() : closeStart()));
$('#start-menu').addEventListener('keydown', e => {
  const items = [...document.querySelectorAll('#start-menu .sm-item')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); } else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
});
$('#start-menu').addEventListener('focusout', e => { if (e.relatedTarget && !$('#start-menu').contains(e.relatedTarget) && e.relatedTarget.id !== 'start-btn') closeStart(false); });
$('#admin-badge').addEventListener('click', toggleAdminLogin);
function tick() { if (paused) return; const d = new Date(); $('#clock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function route(initial) {
  const q = new URLSearchParams(location.search), pid = q.get('post'), pa = q.get('paper'), zv = q.get('view') === 'zine';
  suppressUrl = true;
  if (zv) { if (pid && D.posts.some(p => p.id === pid)) openPost(pid, false, true); else showZineHome(); scrollToZine(true); updateCover(true); }
  else {
    if (!$('#z-home').hidden === false) showZineHome();
    if (initial === undefined || !initial) { if (window.scrollY > 0) scrollToOS(true); }
    if (pid && D.posts.some(p => p.id === pid)) openPost(pid, false); else closeWin('reader', true);
    if (pa && D.papers.some(p => p.id === pa)) openNotes(pa, false); else Object.keys(wins).filter(k => k.startsWith('notes-')).forEach(k => closeWin(k, true));
  }
  suppressUrl = false;
  return !!(pid || pa || zv);
}
addEventListener('popstate', () => route());
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#start-menu').hidden) { closeStart(); return; }
  if (!$('#term').hidden) { $('#term').hidden = true; return; }
  if (!$('#secret').hidden) { $('#secret').hidden = true; return; }
  if (paused || cover > 0) { if (!$('#z-reader').hidden && cover > .9) zineHome(); else scrollToOS(); return; }
  const t = topWin(); if (t) closeWin(t);
});

/* ── boot ── */
async function boot() {
  runIntro();
  applyPrefs(); osArt(); wordmarkHop($('#wordmark')); initDesktop(); buildStart(); try { initPet(); } catch (e) {} tick(); setInterval(tick, 20000);
  await loadData();
  ['posts', 'work', 'reviews', 'reading', 'about', 'guestbook'].forEach(id => mount(id, $('#z-' + id), 'zine'));
  renderAll(); loadGuestbook();
  route(true); updateCover(true);
}
boot();

/* scroll hint: a quiet "scroll ▾" in the middle of the desktop on every visit (the zine has no desktop icon), hidden once you start scrolling */
(function scrollHint() {
  const h = $('#scroll-hint'); if (!h) return;
  try { localStorage.removeItem('pl-scrolled'); } catch (e) {}
  const upd = () => h.classList.toggle('away', window.scrollY > 24);
  window.addEventListener('scroll', upd, { passive: true }); upd();
  h.addEventListener('click', () => { window.scrollTo({ top: zineTop(), behavior: reduced() ? 'auto' : 'smooth' }); });
  setTimeout(() => h.classList.add('show'), 1200);
})();
