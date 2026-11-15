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
          .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function mdToHtml(src) {
  return String(src || '').replace(/\r/g, '').split(/\n{2,}/).map(b => {
    let lines = b.split('\n').filter(l => l.trim()); if (!lines.length) return '';
    let head = '';
    if (/^## /.test(lines[0])) { head = `<h3>${mdInline(esc(lines[0].slice(3)))}</h3>`; lines = lines.slice(1); if (!lines.length) return head; }
    if (lines.every(l => /^- /.test(l))) return head + `<ul>${lines.map(l => `<li>${mdInline(esc(l.slice(2)))}</li>`).join('')}</ul>`;
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

/* ═══════════ CONTENT: one source (data.json), two views (OS windows / zine) ═══════════ */
const APPS = {
  posts: { file: 'posts.exe', label: 'Posts', w: 480, h: 520 },
  work: { file: 'work/', label: 'Work', w: 520, h: 560 },
  reviews: { file: 'reviews/', label: 'Reviews', w: 560, h: 520 },
  reading: { file: 'reading.txt', label: 'Reading', w: 400, h: 460 },
  about: { file: 'about_me.cv', label: 'About', w: 480, h: 560 },
  guestbook: { file: 'guestbook', label: 'Guestbook', w: 420, h: 540 },
};
const mounts = [];
function mount(id, el, mode) { mounts.push({ id, el, mode }); R[id](el, mode); }
function refreshMounts() { for (let i = mounts.length - 1; i >= 0; i--) { const m = mounts[i]; if (!m.el.isConnected) { mounts.splice(i, 1); continue; } R[m.id](m.el, m.mode); } }
const zh = (icon, title) => `<div class="z-head"><img src="assets/icons/${icon}.png" alt="" width="48" height="48"><h2>${title}</h2></div>`;
const R = {
  posts(el, mode) {
    const z = mode === 'zine', list = sortedPosts();
    el.innerHTML = (z ? zh('posts', 'Posts') : '') +
      (!z && isAdmin() ? `<div class="admin-tools"><button class="btn" type="button" data-act="new-post">+ new post</button><button class="btn btn--ghost" type="button" data-act="publish">🚀 publish</button></div>` : '') +
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
    el.innerHTML = (z ? zh('reviews', 'Reviews') : '') + `<div class="${z ? 'cards' : 'rgrid'}">${D.papers.map(p => {
      const notes = (p.notes || '').trim();
      if (!z) return `<button type="button" class="rcard" data-act="open-notes" data-id="${esc(p.id)}">${starsHTML(p.rating || 0)}<span class="rt">${esc(p.title)}</span></button>`;
      return `<article class="card" id="paper-${esc(p.id)}"><div class="card-top">${starsHTML(p.rating || 0)}</div><h3>${esc(p.title)}</h3><div class="tags">${(p.tags || []).slice(0, 4).map(tagHTML).join('')}</div>${notes ? `<details class="notes"><summary>my notes</summary><div class="prose">${plainParas(notes)}</div></details>` : ''}${p.pdfUrl ? `<div class="card-link"><a class="btn btn--ghost" href="${safeHref(p.pdfUrl)}" target="_blank" rel="noopener noreferrer">paper ↗</a></div>` : ''}</article>`;
    }).join('')}</div>`;
  },
  reading(el, mode) {
    el.innerHTML = (mode === 'zine' ? zh('reading', 'Reading list') : '') + (D.readingList.length ? `<ul class="rl">${D.readingList.map(it => `<li>${it.link ? `<a href="${safeHref(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>` : `<span>${esc(it.title)}</span>`}</li>`).join('')}</ul>` : `<p class="empty">nothing queued.</p>`);
  },
  about(el, mode) {
    const cv = D.cv || {}, z = mode === 'zine', interests = String(cv.interests || '').split(',').map(s => s.trim()).filter(Boolean);
    el.innerHTML = (z ? zh('about', 'About') : '') + `<div class="about"><canvas class="about-pet" width="16" height="20" aria-hidden="true"></canvas><div><h3 class="name">Ali Emre Aydın</h3>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}<p class="bio">${esc(cv.bio || '')}</p>${cv.affiliation ? `<p class="aff">${esc(cv.affiliation)}</p>` : ''}${interests.length ? `<div class="chips">${interests.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>` : ''}<div class="about-links">${cv.cvUrl ? `<a class="btn" href="${safeHref(cv.cvUrl)}" target="_blank" rel="noopener noreferrer">CV (PDF) ↗</a>` : ''}<a class="btn btn--ghost" href="https://github.com/uuu4" target="_blank" rel="noopener noreferrer">GitHub ↗</a>${cv.email ? `<a class="btn btn--ghost" href="mailto:${esc(cv.email)}">email</a>` : ''}</div></div></div>`;
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
  openWin({ id: 'reader', side: true, title: p.id + '.md', icon: 'posts', width: 640, height: 640, progress: true, onClose: () => { document.title = DOC_TITLE; clearUrl('post'); } });
  renderPost(p); if (push && new URLSearchParams(location.search).get('post') !== id) setUrl('?post=' + encodeURIComponent(id));
}
function openNotes(id, push = true) {
  const p = D.papers.find(x => x.id === id); if (!p) return;
  const notes = (p.notes || '').trim(), slug = String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 26);
  openWin({ id: 'notes-' + id, side: true, title: slug + '.txt', icon: 'reviews', width: 560, height: 580, onClose: () => clearUrl('paper'), build: b => {
    b.innerHTML = `<div class="reader-in"><div class="reader-date">${starsHTML(p.rating || 0)}</div><h1 class="small">${esc(p.title)}</h1><div class="tags">${(p.tags || []).map(tagHTML).join('')}</div><div class="px-rule" style="margin:16px 0"></div><div class="prose">${notes ? plainParas(notes) : '<p><i>no notes yet.</i></p>'}</div>${p.pdfUrl ? `<p style="margin-top:22px"><a class="btn btn--ghost" href="${safeHref(p.pdfUrl)}" target="_blank" rel="noopener noreferrer">paper ↗</a></p>` : ''}</div>`;
  } });
  if (push && new URLSearchParams(location.search).get('paper') !== id) setUrl('?paper=' + encodeURIComponent(id));
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
function activateHacker() { if (document.body.classList.contains('hacker')) return; document.body.classList.add('hacker'); $('#root-btn').hidden = false; if (!reduced()) startMatrix(); toast('⛓ ACCESS GRANTED'); }
function deactivateHacker() { document.body.classList.remove('hacker'); $('#root-btn').hidden = true; $('#secret').hidden = true; toast('systems re-secured'); }
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
prefs = Object.assign({ theme: 'warm', scan: false }, prefs);
const savePrefs = () => lsSet('zine-prefs', JSON.stringify(prefs));
function applyPrefs() { if (!THEMES[prefs.theme]) prefs.theme = 'warm'; document.body.dataset.theme = prefs.theme; document.body.classList.toggle('scan', !!prefs.scan); }
const mobile = () => matchMedia('(max-width:720px)').matches;
const TB = 46; // taskbar height
let suppressUrl = false;
const setUrl = q => { try { history.pushState({}, '', location.pathname + q); } catch (e) {} };
const clearUrl = key => { if (suppressUrl) return; if (new URLSearchParams(location.search).get(key)) { try { history.replaceState({}, '', location.pathname); } catch (e) {} } };

/* ── admin: login, post editor, publish (same worker contract as the old app.js) ── */
const ADMIN_KEY = 'pl-admin-session', PW_KEY = 'pl-admin-pw', STORE_KEY = 'pl-v4', CV_KEY = 'pl-cv-v4', NOTE_KEY = 'pl-note-v4', RL_KEY = 'pl-rl-v1', POSTS_KEY = 'pl-posts-v1';
const isAdmin = () => lsGet(ADMIN_KEY) === '1';
function setAdmin(v) { try { if (v) localStorage.setItem(ADMIN_KEY, '1'); else localStorage.removeItem(ADMIN_KEY); } catch (e) {} updateBadge(); updateStart(); }
function updateBadge() { const b = $('#admin-badge'); if (!b) return; const a = isAdmin(); b.className = a ? 'unlocked' : 'locked'; $('span', b).textContent = a ? 'ADMIN' : 'GUEST'; b.title = a ? 'Admin: click to log out' : 'Admin login'; }
const savePosts = () => { if (isAdmin()) lsSet(POSTS_KEY, JSON.stringify(D.posts)); };
const publishedData = () => ({ papers: D.papers, cv: D.cv, note: D.note, readingList: D.readingList, work: D.work, posts: D.posts });
let remoteOk = false; // publish is refused unless data.json actually loaded (an empty payload would wipe content)
async function loadData() {
  let s = {}; remoteOk = false;
  try { const r = await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { s = await r.json(); remoteOk = true; } } catch (e) {}
  // Old-app drafts for papers/cv/note/reading list have no editor here: drop them so they can't shadow or overwrite newer remote content.
  [STORE_KEY, CV_KEY, NOTE_KEY, RL_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  const tp = k => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };
  D.papers = s.papers || []; D.cv = s.cv || {}; D.note = s.note || ''; D.readingList = s.readingList || [];
  const draft = isAdmin() ? tp(POSTS_KEY) : null;
  D.posts = Array.isArray(draft) && draft.length ? draft : (s.posts || []);
  D.work = s.work || [];
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
  if (!remoteOk) { toast("data.json didn't load — reload the page before publishing"); return; }
  toast('Publishing…');
  try {
    const r = await fetch(WORKER_URL + '/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass, data: publishedData(), message: msg }) });
    if (r.ok) { [STORE_KEY, CV_KEY, NOTE_KEY, RL_KEY, POSTS_KEY].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); renderAll(); toast('Committed ✓ — deploying…'); pollDeploy(publishedData()); }
    else if (r.status === 401) { try { sessionStorage.removeItem(PW_KEY); } catch (e) {} setAdmin(false); toast('Auth expired — log in again'); openLogin(); }
    else { const e = await r.json().catch(() => ({})); toast('Publish failed: ' + (e.error || r.status)); }
  } catch (e) { toast('Network error'); }
}
async function pollDeploy(expected, left = 20) {
  if (left <= 0) { toast('Committed ✓ — still deploying, check back shortly'); return; }
  await new Promise(r => setTimeout(r, 3000));
  try { const live = await (await fetch('./data.json?t=' + Date.now(), { cache: 'no-store' })).json(); if (JSON.stringify(live) === JSON.stringify(expected)) { toast('Deployed ✓ — live now'); return; } } catch (e) {}
  pollDeploy(expected, left - 1);
}
function postSlug(title) {
  const base = (String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)) || 'post';
  let s = base, i = 2; while (D.posts.some(p => p.id === s)) s = `${base}-${i++}`; return s;
}
function openPostEditor(id) {
  if (!isAdmin()) { toast('Admin only'); return; }
  const p = id ? D.posts.find(x => x.id === id) : null;
  openWin({ id: 'post-editor', title: p ? 'edit_post.md' : 'new_post.md', icon: 'posts', width: 640, height: 700, build: b => {
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
    const W = Math.min(o.width || 560, innerWidth - 24), H = Math.min(o.height || 520, innerHeight - TB - 24), n = Math.max(0, Object.values(wins).filter(x => !x.o.dialog).length - 1) % 7;
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
  focusWin(id); syncLock(); return w;
}
function setWinTitle(id, t) { const w = wins[id]; if (!w) return; $('.ttl', w.el).textContent = t; const b = $(`.tb-btn[data-win="${id}"] span`); if (b) b.textContent = t; w.el.setAttribute('aria-label', t); }
function focusWin(id) { const w = wins[id]; if (!w) return; if (++zTop > 380) { Object.keys(wins).sort((p, q) => (+wins[p].el.style.zIndex || 0) - (+wins[q].el.style.zIndex || 0)).forEach((k, i) => { wins[k].el.style.zIndex = 200 + i; }); zTop = 200 + Object.keys(wins).length; } w.el.style.zIndex = zTop; document.querySelectorAll('.win').forEach(x => x.classList.toggle('focused', x === w.el)); document.querySelectorAll('.tb-btn.wbtn').forEach(b => b.classList.toggle('active', b.dataset.win === id)); }
function minWin(id, on) { const w = wins[id]; if (!w) return; w.el.classList.toggle('min', on); const b = $(`.tb-btn[data-win="${id}"]`); if (b) { b.classList.toggle('mini', on); if (on) b.classList.remove('active'); } }
function closeWin(id, silent) {
  const w = wins[id]; if (!w) return;
  const prev = suppressUrl; if (silent) suppressUrl = true;
  w.o.onClose && w.o.onClose(); suppressUrl = prev;
  w.el.remove(); delete wins[id]; $(`.tb-btn[data-win="${id}"]`)?.remove();
  if (!Object.values(wins).some(x => x.o.dialog)) $('#scrim').hidden = true;
  const t = topWin(); if (t) focusWin(t); syncLock();
}
function topWin() { let best = null, z = -1; Object.keys(wins).forEach(id => { const e = wins[id].el; if (!e.classList.contains('min') && (+e.style.zIndex || 0) > z) { z = +e.style.zIndex || 0; best = id; } }); return best; }
function closeAllWins() { Object.keys(wins).forEach(id => closeWin(id, true)); }

function openPrefs() {
  openWin({ id: 'prefs', title: 'preferences.cfg', icon: 'about', width: 520, height: 560, build: b => {
    b.innerHTML = `<div class="frm prefs"><fieldset><legend>Wallpaper</legend><div class="wp-grid">${WALLS.map(n => `<label class="wp-opt"><input type="radio" name="wp" value="${n}"><span style="background-image:url(assets/wallpapers/${n}.webp)"></span><b>${n}</b></label>`).join('')}</div></fieldset>
      <fieldset><legend>Theme</legend>${Object.keys(THEMES).map(k => `<label class="opt"><input type="radio" name="theme" value="${k}"> ${THEMES[k]}</label>`).join('')}</fieldset>
      <fieldset><legend>Display</legend><label class="opt"><input type="checkbox" id="pf-scan"> CRT scanlines</label></fieldset>
      <small>Saved in this browser only.</small></div>`;
    const cur = lsGet('zine-wall') || 'waves'; $(`[name=wp][value="${cur}"]`, b).checked = true; $(`[name=theme][value="${prefs.theme}"]`, b).checked = true; $('#pf-scan', b).checked = !!prefs.scan;
    b.addEventListener('change', e => { const t = e.target; if (t.name === 'wp') window._setWall && window._setWall(t.value); else if (t.name === 'theme') { prefs.theme = t.value; savePrefs(); applyPrefs(); } else if (t.id === 'pf-scan') { prefs.scan = t.checked; savePrefs(); applyPrefs(); } });
  } });
}
/* ═══════════ OS: wallpaper, intro, apps, zine switch, start menu, pet ═══════════ */
const DOC_TITLE = 'internetpersona — Ali Emre Aydın';
const NAME_LINE = 'ali emre aydın', TAG_LINE = 'machine learning by day, things i build at 2am by night.';
const TAGLINE = NAME_LINE + '. ' + TAG_LINE;
const WALLS = ['waves', 'ribbons', 'dunes', 'mesh'];
function osArt() {
  // Static wallpaper (drawn once per change) + a pointer glow that only repaints while the glow is still easing. No continuous loop.
  const c = $('#art'), ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const imgs = {}; let idx = Math.max(0, WALLS.indexOf(lsGet('zine-wall') || 'waves')), mx = .7, my = .4, tmx = .7, tmy = .4, raf = 0;
  const W = c.width, H = c.height;
  const load = n => imgs[n] || (imgs[n] = Object.assign(new Image(), { src: `assets/wallpapers/${n}.webp`, onload: () => draw() }));
  function draw() {
    const im = imgs[WALLS[idx]]; if (!im || !im.complete || !im.naturalWidth) return;
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(im, 0, 0, W, H);
    if (reduced()) return;
    ctx.globalCompositeOperation = 'lighter';
    const lx = mx * W, ly = my * H, g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 90); g.addColorStop(0, 'rgba(232,160,64,.26)'); g.addColorStop(1, 'rgba(232,160,64,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  function ease() { raf = 0; if (paused || booting()) return; mx += (tmx - mx) * .18; my += (tmy - my) * .18; draw(); if (Math.abs(tmx - mx) + Math.abs(tmy - my) > .004) raf = requestAnimationFrame(ease); }
  load(WALLS[idx]); setTimeout(() => WALLS.forEach(load), 1500);
  $('#os').addEventListener('pointermove', e => { if (reduced() || paused || booting()) return; tmx = e.clientX / innerWidth; tmy = e.clientY / innerHeight; if (!raf) raf = requestAnimationFrame(ease); }, { passive: true });
  window._setWall = n => { idx = Math.max(0, WALLS.indexOf(n)); lsSet('zine-wall', WALLS[idx]); load(WALLS[idx]); draw(); };
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
    <button type="button" role="menuitem" class="sm-item" data-sm="admin"><span class="sm-g">●</span><span id="sm-admin">Admin login</span></button></div>`;
  $('#tb-quick').innerHTML = ['posts', 'work', 'reviews', 'about', 'zine'].map(id => `<button type="button" class="tb-btn q" data-app="${id}" aria-label="${id}"><img src="assets/icons/${id}.png" alt="" width="24" height="24"></button>`).join('');
  updateStart();
}
function updateStart() { const a = $('#sm-admin'); if (a) a.textContent = isAdmin() ? 'Log out (admin)' : 'Admin login'; }
function openStart() { const m = $('#start-menu'); m.hidden = false; $('#start-btn').setAttribute('aria-expanded', 'true'); updateStart(); $('.sm-item', m).focus(); }
function closeStart(refocus = true) { const m = $('#start-menu'); if (m.hidden) return; m.hidden = true; $('#start-btn').setAttribute('aria-expanded', 'false'); if (refocus) $('#start-btn').focus(); }
function startAction(a) { closeStart(false); if (a === 'prefs') openPrefs(); else if (a === 'restart') restartOS(); else if (a === 'admin') toggleAdminLogin(); }
function restartOS() {
  closeAllWins(); closeStart(false); $('#term').hidden = true; scrollToOS(true); showZineHome();
  if (!reduced()) { const f = $('#crt-flash'); f.hidden = false; f.className = ''; void f.offsetWidth; f.className = 'go'; setTimeout(() => { f.hidden = true; f.className = ''; }, 1100); setTimeout(runIntro, 900); }
}

/* ── desktop: draggable sticky note ── */
function initDesktop() {
  const st = $('#sticky'), os = $('#os'); let ox = 0, oy = 0;
  st.addEventListener('pointerdown', e => { if (mobile()) return; const r = st.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; st.setPointerCapture(e.pointerId); st.classList.add('drag');
    const mv = ev => { st.style.right = 'auto'; st.style.left = Math.min(innerWidth - 80, Math.max(0, ev.clientX - ox)) + 'px'; st.style.top = Math.min(innerHeight - TB - 60, Math.max(0, ev.clientY - oy)) + 'px'; };
    const up = () => { st.classList.remove('drag'); st.removeEventListener('pointermove', mv); st.removeEventListener('pointerup', up); }; st.addEventListener('pointermove', mv); st.addEventListener('pointerup', up); });
  st.addEventListener('keydown', e => { const k = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key]; if (!k) return; e.preventDefault(); const r = st.getBoundingClientRect(); st.style.right = 'auto'; st.style.left = (r.left + k[0]) + 'px'; st.style.top = (r.top + k[1]) + 'px'; });
}
function renderSticky() {
  const paras = String(D.note || '').trim().split(/\n{2,}/), note = (paras.length > 1 ? paras.slice(1) : paras).join('\n\n').trim();
  $('#sticky-text').textContent = note; $('#sticky').hidden = !note;
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
     'copy-link': () => { const u = location.origin + location.pathname + '?post=' + encodeURIComponent(id); try { navigator.clipboard.writeText(u); toast('link copied ✓'); } catch (er) { toast(u); } } }[ac.dataset.act] || (() => {}))();
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

/* scroll hint: one small nudge that the zine lives below the OS */
(function scrollHint() {
  const h = $('#scroll-hint'); if (!h) return;
  let seen = false; try { seen = localStorage.getItem('pl-scrolled') === '1'; } catch (e) {}
  if (seen) { h.classList.add('gone'); return; }
  const hide = () => { h.classList.add('gone'); try { localStorage.setItem('pl-scrolled', '1'); } catch (e) {} window.removeEventListener('scroll', onScroll); };
  const onScroll = () => { if (window.scrollY > 24) hide(); };
  window.addEventListener('scroll', onScroll, { passive: true });
  h.addEventListener('click', () => { window.scrollTo({ top: zineTop(), behavior: reduced() ? 'auto' : 'smooth' }); });
  setTimeout(() => h.classList.add('show'), 1200);
})();
