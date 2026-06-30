// ── SAFE STORAGE ──────────────────────────────────────────
let _lsOk = true;
try { localStorage.setItem('__plt','1'); localStorage.removeItem('__plt'); }
catch(e){ _lsOk = false; }
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
function lsRemove(k){ try { localStorage.removeItem(k); } catch(e){} }

// ── HTML ESCAPE ───────────────────────────────────────────
const _ESC = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>_ESC[c]); }

// ── PUBLISH WORKER ────────────────────────────────────────
// Cloudflare Worker that verifies the admin password and commits data.json to the repo.
// Empty string => admin login is disabled (read-only site).
const WORKER_URL = 'https://personaos-publish.uuu4.workers.dev';

// ── ADMIN AUTH ───────────────────────────────────────────
// Real authentication is done by the Worker against ADMIN_PASSWORD secret.
// This module only tracks "am I logged in?" locally; password held in sessionStorage.
const ADMIN_KEY = 'pl-admin-session';
const PW_SESSION_KEY = 'pl-admin-pw';

function isAdmin(){ return lsGet(ADMIN_KEY)==='1'; }
function setAdmin(v){ if(v) lsSet(ADMIN_KEY,'1'); else lsRemove(ADMIN_KEY); updateAdminBadge(); }
function updateAdminBadge(){
  const b=document.getElementById('admin-badge'); if(!b)return;
  if(isAdmin()){ b.className='unlocked'; b.textContent='🔓 ADMIN'; }
  else { b.className='locked'; b.textContent='🔒 GUEST'; }
}

function toggleAdminLogin(){
  if(isAdmin()){
    if(confirm('Log out from admin?')){
      setAdmin(false);
      try { sessionStorage.removeItem(PW_SESSION_KEY); } catch(e){}
      refreshOpens();
      toast('Logged out');
    }
  } else {
    if(!WORKER_URL){ toast('Publishing not configured — read-only site'); return; }
    openLoginWindow();
  }
}

function openLoginWindow(){
  if(openWindows['login']){bringToFront(openWindows['login']);return;}
  createWindow({id:'login',title:'Admin Login',icon:'🔐',width:320,height:210,statusText:'Verified by publish worker',buildBody:inner=>{
    inner.innerHTML=`<div class="window-body">
      <div class="section-label" style="margin-bottom:8px">PASSWORD</div>
      <input class="form-input" id="login-pass" type="password" placeholder="Enter password…" onkeydown="if(event.key==='Enter')submitLogin()" autofocus>
      <div id="login-err" style="color:#8b1a1a;font-size:14px;margin-top:6px;font-family:'Pixelify Sans',monospace"></div>
      <div style="display:flex;gap:6px;margin-top:12px">
        <button class="win-btn" id="login-btn" onclick="submitLogin()">[ Login ]</button>
        <button class="win-btn" onclick="closeWindow('login')">[ Cancel ]</button>
      </div>
      <hr class="divider">
      <div style="font-size:13px;color:var(--muted);font-family:'Pixelify Sans',monospace">Verified server-side. Wrong attempts are rate-limited.</div>
    </div>`;
    setTimeout(()=>document.getElementById('login-pass')?.focus(),100);
  }});
}

async function submitLogin(){
  const pass=document.getElementById('login-pass')?.value||'';
  const errEl=document.getElementById('login-err');
  const btn=document.getElementById('login-btn');
  if(errEl) errEl.textContent='';
  if(!WORKER_URL){ if(errEl) errEl.textContent='Worker not configured.'; return; }
  if(!pass){ if(errEl) errEl.textContent='Enter a password.'; return; }
  if(btn){ btn.disabled=true; btn.textContent='[ … ]'; }
  try {
    const r = await fetch(WORKER_URL.replace(/\/$/,'') + '/verify', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: pass })
    });
    if(r.ok){
      try { sessionStorage.setItem(PW_SESSION_KEY, pass); } catch(e){}
      setAdmin(true);
      closeWindow('login');
      await bootData();
      renderFolderGrid(); renderFolderToolbar(); refreshOpenPapers();
      if(document.getElementById('cv-body')) renderCV();
      toast('Admin verified ✓');
    } else if(r.status===401){
      if(errEl) errEl.textContent='Incorrect password.';
    } else {
      if(errEl) errEl.textContent='Worker error: '+r.status;
    }
  } catch(e){
    if(errEl) errEl.textContent='Cannot reach worker.';
  } finally {
    if(btn){ btn.disabled=false; btn.textContent='[ Login ]'; }
  }
}

async function publishToWorker(){
  if(!WORKER_URL){ toast('Worker not configured'); return; }
  let pass=''; try { pass = sessionStorage.getItem(PW_SESSION_KEY) || ''; } catch(e){}
  if(!pass){ toast('Session expired — log in again'); setAdmin(false); openLoginWindow(); return; }
  const msg = prompt('Commit message:', 'Update via personaOS');
  if(msg===null) return;
  toast('Publishing…');
  try {
    const r = await fetch(WORKER_URL.replace(/\/$/,'') + '/publish', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: pass, data: { papers, cv, note: stickyNote }, message: msg })
    });
    if(r.ok){
      // Clear local draft — the commit IS the published state.
      // Don't re-fetch data.json: GitHub Pages takes 30-90 sec to redeploy,
      // so bootData() would pull stale remote and clobber in-memory cv/papers.
      lsRemove(STORE_KEY); lsRemove(CV_KEY); lsRemove(NOTE_KEY);
      renderFolderGrid(); renderFolderToolbar(); refreshOpenPapers();
      if(document.getElementById('cv-body')) renderCV();
      renderStickyNote();
      toast('Published ✓ — live in ~30 sec');
    } else if(r.status===401){
      try { sessionStorage.removeItem(PW_SESSION_KEY); } catch(e){}
      setAdmin(false);
      toast('Auth expired — log in again');
      openLoginWindow();
    } else {
      const err = await r.json().catch(()=>({}));
      toast('Publish failed: '+(err.error||r.status));
    }
  } catch(e){
    toast('Network error');
  }
}

function refreshOpenPapers(){
  papers.forEach(p=>{ const el=document.getElementById('pb-'+p.id); if(el) renderPaperBody(p); });
  renderFolderToolbar();
}

// ── PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// ── DATA ─────────────────────────────────────────────────
const STORE_KEY = 'pl-v4', CV_KEY = 'pl-cv-v4', NOTE_KEY = 'pl-note-v4';

const DEFAULT_PAPERS = [
  {id:'p1',title:'Attention Is All You Need',authors:'Vaswani, A., Shazeer, N., Parmar, N., et al.',year:2017,venue:'NeurIPS',tags:['transformers','attention','NLP'],abstract:'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',rating:5,notes:'Revolutionary paper. The multi-head attention mechanism is elegant. Positional encoding section needs re-reading.',icon:'🔬',pdfUrl:''}
];
const DEFAULT_CV = {
  name:'Your Name',role:'Researcher · PhD Candidate',avatar:'🧑‍💻',
  bio:'Write a short bio about yourself, your research interests, and current work.',
  affiliation:'University / Lab name',email:'you@example.com',website:'yoursite.com',
  interests:'Machine Learning, Reinforcement Learning, NLP'
};

let papers = [];
let cv = { ...DEFAULT_CV };
let stickyNote = '';       // plain text, published in data.json
let remoteSnapshot = null;

async function loadRemoteData(){
  try {
    const r = await fetch('./data.json?t='+Date.now(), { cache:'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch(e){ return null; }
}

async function bootData(){
  remoteSnapshot = await loadRemoteData();
  const tryParse = k => { try { return JSON.parse(lsGet(k)||'null'); } catch(e){ return null; } };
  if (isAdmin()) {
    papers     = tryParse(STORE_KEY) || (remoteSnapshot && remoteSnapshot.papers) || DEFAULT_PAPERS;
    cv         = tryParse(CV_KEY)    || (remoteSnapshot && remoteSnapshot.cv)     || { ...DEFAULT_CV };
    stickyNote = tryParse(NOTE_KEY)  ?? (remoteSnapshot && remoteSnapshot.note)   ?? '';
  } else {
    papers     = (remoteSnapshot && remoteSnapshot.papers) || DEFAULT_PAPERS;
    cv         = (remoteSnapshot && remoteSnapshot.cv)     || { ...DEFAULT_CV };
    stickyNote = (remoteSnapshot && remoteSnapshot.note)   || '';
  }
  renderStickyNote();
}

// Visitors don't write to localStorage. Only admin drafts persist.
function savePapers(){ if(isAdmin()) lsSet(STORE_KEY, JSON.stringify(papers)); }
function saveCV()    { if(isAdmin()) lsSet(CV_KEY,    JSON.stringify(cv)); }
function saveNote()  { if(isAdmin()) lsSet(NOTE_KEY,  JSON.stringify(stickyNote)); }

function exportData(){
  const payload = { papers, cv, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'data.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('data.json downloaded — commit to repo to publish');
}

async function pullRemote(){
  if(!confirm('Discard your local draft and pull data.json from the server?')) return;
  lsRemove(STORE_KEY); lsRemove(CV_KEY);
  await bootData();
  renderFolderGrid(); renderFolderToolbar(); refreshOpenPapers();
  if(document.getElementById('cv-body')) renderCV();
  const fw = openWindows['reviews']; if(fw) fw.querySelector('.window-statusbar').textContent=`${papers.length} papers · double-click to open`;
  toast(remoteSnapshot ? 'Pulled remote ✓' : 'No data.json on server — using defaults');
}

function hasLocalDraft(){ return !!(lsGet(STORE_KEY) || lsGet(CV_KEY)); }

// ── TAG COLORS ────────────────────────────────────────────
const TAG_PALETTE = [
  {bg:'#2c4a1c',border:'#4a7830',text:'#b8e890'},
  {bg:'#1c2c4a',border:'#2a4878',text:'#90b8e8'},
  {bg:'#4a1c2c',border:'#782a48',text:'#e890b8'},
  {bg:'#3a2c1c',border:'#6a5030',text:'#e8c890'},
  {bg:'#2a1c4a',border:'#4a3078',text:'#c890e8'},
  {bg:'#1c3a3a',border:'#2a6060',text:'#90e0e0'},
  {bg:'#3a3a1c',border:'#606030',text:'#e0e090'},
];
const tagColorCache = {};
function tagColor(t) {
  if (!tagColorCache[t]) { let h=0; for(let c of t) h=(h*31+c.charCodeAt(0))&0xff; tagColorCache[t]=TAG_PALETTE[h%TAG_PALETTE.length]; }
  return tagColorCache[t];
}
function tagHTML(t) { const c=tagColor(t); return `<span class="tag" style="background:${c.bg};border-color:${c.border};color:${c.text}">${esc(t)}</span>`; }
function allTags(){ const s=new Set(); papers.forEach(p=>(p.tags||[]).forEach(t=>s.add(t))); return [...s].sort(); }
function tagEditorHTML(p){
  const chips=(p.tags||[]).map((t,i)=>{const c=tagColor(t);return `<span class="tag" style="background:${c.bg};border-color:${c.border};color:${c.text}">${esc(t)}<span class="tag-x" onclick="removeTag('${p.id}',${i})">×</span></span>`;}).join('');
  return `${chips}<input class="tag-add" id="tagin-${p.id}" list="alltags-${p.id}" placeholder="+tag" onkeydown="if(event.key==='Enter'){event.preventDefault();addTag('${p.id}')}"><datalist id="alltags-${p.id}">${allTags().map(t=>`<option value="${esc(t)}">`).join('')}</datalist>`;
}
function addTag(id){
  const p=papers.find(x=>x.id===id); if(!p)return;
  const inp=document.getElementById('tagin-'+id); if(!inp)return;
  const v=inp.value.trim(); if(!v)return;
  p.tags=p.tags||[];
  if(!p.tags.includes(v)) p.tags.push(v);
  savePapers(); renderPaperBody(p); renderFolderToolbar();
  document.getElementById('tagin-'+id)?.focus();
}
function removeTag(id,i){
  const p=papers.find(x=>x.id===id); if(!p||!p.tags)return;
  p.tags.splice(i,1);
  savePapers(); renderPaperBody(p);
}
function starsHTML(rating, id, editable=true) {
  return [1,2,3,4,5].map(i=>`<span class="star ${i<=rating?'lit':'unlit'}" ${editable?`onclick="setRating('${id}',${i},this)"`:'style="cursor:default"'}>★</span>`).join('');
}

// ── PDF PREVIEW ───────────────────────────────────────────
// Strategy: try PDF.js (native render, works when host allows CORS).
// If CORS blocks it, fall back to Google Docs Viewer iframe (works for any public URL).
async function renderPdfPreview(url, containerId) {
  const box = document.getElementById(containerId);
  if (!box) return;
  if (!url || !url.trim()) {
    box.innerHTML = `<div class="pdf-placeholder">[ No PDF\nlink set ]\n\nEdit paper\nto add URL</div>`;
    return;
  }
  const clean = url.trim();
  box.innerHTML = `<div class="pdf-placeholder">Loading\npdf...</div>`;

  // ── Try PDF.js first ──
  try {
    const loadingTask = pdfjsLib.getDocument({ url: clean, withCredentials: false });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    box.innerHTML = '';
    box.appendChild(canvas);
    return;
  } catch(e) {
    // CORS or network error → fall through to iframe fallback
  }

  // ── Fallback: our Cloudflare Worker proxy → PDF.js (clean canvas, no UI chrome) ──
  try {
    const proxyUrl = `${WORKER_URL}/pdf?url=${encodeURIComponent(clean)}`;
    const loadingTask = pdfjsLib.getDocument({ url: proxyUrl, withCredentials: false });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    box.innerHTML = '';
    box.appendChild(canvas);
  } catch(e) {
    box.innerHTML = `<div class="pdf-placeholder">[ Preview\nunavailable ]\n\nURL must be\npublicly accessible</div>`;
  }
}

// ── WINDOW SYSTEM ─────────────────────────────────────────
let zTop = 100;
const openWindows = {};

function bringToFront(win) {
  zTop++; win.style.zIndex = zTop;
  document.querySelectorAll('.window').forEach(w=>w.classList.remove('focused'));
  win.classList.add('focused');
}
function toggleMaximize(win){
  if(win.classList.contains('maximized')){
    win.classList.remove('maximized');
    const s=win._prevState||{};
    win.style.left=s.left||'60px'; win.style.top=s.top||'40px';
    win.style.width=s.width||'480px'; win.style.height=s.height||'440px';
  } else {
    win._prevState={left:win.style.left,top:win.style.top,width:win.style.width,height:win.style.height};
    win.classList.add('maximized');
  }
}
function makeDraggable(win, handle) {
  let dx,dy,dragging=false,moved=false;
  handle.addEventListener('mousedown', e=>{
    if(e.target.closest('.wbtn-group'))return;
    dragging=true; moved=false;
    dx=e.clientX-win.offsetLeft; dy=e.clientY-win.offsetTop;
    bringToFront(win); e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging)return;
    moved=true;
    if(win.classList.contains('maximized')) win.classList.remove('maximized');
    win.style.left=Math.max(0,Math.min(e.clientX-dx,window.innerWidth-win.offsetWidth))+'px';
    win.style.top=Math.max(0,Math.min(e.clientY-dy,window.innerHeight-34-win.offsetHeight))+'px';
  });
  document.addEventListener('mouseup', ()=>{ if(dragging){ dragging=false; } });
  // Double-click titlebar to maximize/restore
  handle.addEventListener('dblclick', e=>{
    if(e.target.closest('.wbtn-group'))return;
    toggleMaximize(win); playSound('open');
  });
}
function makeResizable(win) {
  const h=win.querySelector('.resize-handle'); if(!h)return;
  let r=false,sx,sy,sw,sh,squishToasted=false;
  h.addEventListener('mousedown',e=>{r=true;sx=e.clientX;sy=e.clientY;sw=win.offsetWidth;sh=win.offsetHeight;squishToasted=false;e.preventDefault();e.stopPropagation();});
  document.addEventListener('mousemove',e=>{
    if(!r)return;
    const nw=sw+e.clientX-sx, nh=sh+e.clientY-sy;
    if((nw<260||nh<130)&&!squishToasted){
      squishToasted=true;
      const msgs=['sıkıştım!','çok küçüğüm!','biraz daha büyüt beni','nefes alamıyorum 😵'];
      toast(msgs[Math.floor(Math.random()*msgs.length)]);
    }
    win.style.width=Math.max(300,nw)+'px';
    win.style.height=Math.max(160,nh)+'px';
  });
  document.addEventListener('mouseup',()=>{ if(r){ r=false; } });
}
const WIN_SCALE = {small:0.72, medium:1.0, large:1.38};
function createWindow({id,title,icon='📄',width=480,height=440,x,y,buildBody,statusText=''}) {
  if(openWindows[id]){const w=openWindows[id];w.classList.remove('minimized');bringToFront(w);updateTaskbarBtn(id,false);playSound('click');return w;}
  const sc=WIN_SCALE[prefs?.winSize]||1; width=Math.round(width*sc); height=Math.round(height*sc);
  const win=document.createElement('div');
  win.className='window'; win.dataset.winId=id;
  win.style.cssText=`width:${width}px;height:${height}px;left:${x!==undefined?x:Math.max(20,30+Math.random()*(window.innerWidth-width-80))}px;top:${y!==undefined?y:Math.max(20,40+Math.random()*(window.innerHeight-height-80))}px`;
  win.innerHTML=`<div class="titlebar"><span class="title-text">${icon} ${title}</span><div class="wbtn-group"><button class="wbtn wbtn-min" title="Minimize" data-sym="–"></button><button class="wbtn wbtn-max" title="Maximize" data-sym="□"></button><button class="wbtn wbtn-close close-x" title="Close" data-sym="✕"></button></div></div><div class="win-inner" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden"></div><div class="window-statusbar">${statusText}</div><div class="resize-handle"></div>`;
  document.body.appendChild(win);
  openWindows[id]=win;
  buildBody(win.querySelector('.win-inner'));
  makeDraggable(win,win.querySelector('.titlebar'));
  makeResizable(win);
  win.querySelector('.close-x').onclick=()=>closeWindow(id);
  win.querySelector('.wbtn-min').onclick=()=>minimizeWindow(id);
  win.querySelector('.wbtn-max').onclick=()=>{toggleMaximize(win);playSound('open');};
  win.addEventListener('mousedown',()=>bringToFront(win));
  addTaskbarBtn(id,icon+' '+title);
  bringToFront(win);
  playSound('open');
  return win;
}
function closeWindow(id){const w=openWindows[id];if(!w)return;playSound('close');w.classList.add('closing');setTimeout(()=>{w.remove();delete openWindows[id];removeTaskbarBtn(id);},100);}
function minimizeWindow(id){const w=openWindows[id];if(!w)return;playSound('minimize');w.classList.add('minimized');updateTaskbarBtn(id,true);}
function restoreWindow(id){const w=openWindows[id];if(!w)return;w.classList.remove('minimized');bringToFront(w);updateTaskbarBtn(id,false);}

function addTaskbarBtn(id,label){const bar=document.getElementById('taskbar-items');const btn=document.createElement('button');btn.className='taskbar-btn active';btn.dataset.winId=id;btn.textContent=label.length>22?label.slice(0,20)+'…':label;btn.onclick=()=>{const w=openWindows[id];if(!w)return;if(w.classList.contains('minimized'))restoreWindow(id);else if(w.classList.contains('focused')&&parseInt(w.style.zIndex)===zTop)minimizeWindow(id);else bringToFront(w);};bar.appendChild(btn);}
function removeTaskbarBtn(id){document.querySelector(`.taskbar-btn[data-win-id="${id}"]`)?.remove();}
function updateTaskbarBtn(id,min){const b=document.querySelector(`.taskbar-btn[data-win-id="${id}"]`);if(b)b.classList.toggle('active',!min);}

let _lastClockStr='';
function tick(){
  const n=new Date();
  const s=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  document.getElementById('clock').textContent=s;
  if(s==='00:00'&&_lastClockStr!=='00:00'){
    setTimeout(()=>toast('🌙 gece yarısı oldu. hâlâ paper mı okuyorsun?'),400);
  }
  _lastClockStr=s;
}
tick();setInterval(tick,10000);
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}

// ── HOVER PREVIEW ─────────────────────────────────────────
const previewCard=document.getElementById('preview-card');
let previewTimeout;
function showPreview(p,e){clearTimeout(previewTimeout);previewTimeout=setTimeout(()=>{document.getElementById('pc-title').textContent=p.title;document.getElementById('pc-meta').textContent=`${(p.authors||'').split(',')[0]} et al. · ${p.venue} ${p.year}`;document.getElementById('pc-stars').innerHTML=[1,2,3,4,5].map(i=>`<span style="color:${i<=p.rating?'#d89020':'#c8b880'}">★</span>`).join('');const x=Math.min(e.clientX+14,window.innerWidth-260);const y=Math.min(e.clientY+10,window.innerHeight-120);previewCard.style.left=x+'px';previewCard.style.top=y+'px';previewCard.classList.add('show');},350);}
function hidePreview(){clearTimeout(previewTimeout);previewCard.classList.remove('show');}

// ── REVIEWS FOLDER ────────────────────────────────────────
function openReviews(){
  createWindow({id:'reviews',title:'Reviews',icon:'📁',width:520,height:380,statusText:`${papers.length} papers · double-click to open`,buildBody:inner=>{
    inner.innerHTML=`<div class="folder-toolbar" id="folder-toolbar"></div><div class="window-body" style="padding:10px"><div class="folder-grid" id="folder-grid"></div></div>`;
    renderFolderToolbar();
    renderFolderGrid();
  }});
}

function renderFolderToolbar(){
  const tb=document.getElementById('folder-toolbar');if(!tb)return;
  if(isAdmin()){
    const draft = hasLocalDraft();
    const pubBtn = WORKER_URL ? `<button class="win-btn" onclick="publishToWorker()" title="Commit data.json via worker">🚀 Publish</button>` : '';
    tb.innerHTML = `
      <button class="win-btn" onclick="openAddPaper()">📄 Add Paper</button>
      ${pubBtn}
      <button class="win-btn" onclick="exportData()" title="Download data.json (manual backup)">⬇ Export</button>
      <button class="win-btn" onclick="pullRemote()" title="Discard local draft and reload server data.json">↻ Pull</button>
      <span style="font-size:13px;color:${draft?'#c87820':'var(--accent)'};font-family:'Pixelify Sans',monospace;margin-left:6px">${draft?'● local draft — Publish to push live':'🔓 Admin mode'}</span>`;
  } else {
    const hint = WORKER_URL ? '🔒 Read-only — click 🔒 GUEST to log in' : '🔒 Read-only';
    tb.innerHTML = `<span style="font-size:14px;color:var(--muted);font-family:'Pixelify Sans',monospace">${hint}</span>`;
  }
}

function renderFolderGrid(){
  const grid=document.getElementById('folder-grid');if(!grid)return;
  grid.innerHTML='';
  papers.forEach(p=>{
    const el=document.createElement('div');el.className='folder-icon';
    el.innerHTML=`<div class="f-img">${esc(p.icon)}</div><div class="f-label">${esc(p.title)}</div>`;
    el.addEventListener('click',()=>{document.querySelectorAll('.folder-icon').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');});
    el.addEventListener('dblclick',()=>openPaper(p.id));
    el.addEventListener('mouseenter',e=>showPreview(p,e));
    el.addEventListener('mousemove',e=>{if(previewCard.classList.contains('show')){previewCard.style.left=Math.min(e.clientX+14,window.innerWidth-260)+'px';previewCard.style.top=Math.min(e.clientY+10,window.innerHeight-120)+'px';}});
    el.addEventListener('mouseleave',hidePreview);
    grid.appendChild(el);
  });
}

// ── GUESTBOOK ─────────────────────────────────────────────
// Stored in the Worker's KV (never committed). Visitors leave notes that
// stay hidden until the admin approves them.
function openGuestbook(){
  createWindow({id:'guestbook',title:'Guestbook',icon:'📬',width:420,height:540,statusText:'leave a note for the host',buildBody:inner=>{
    inner.innerHTML=`<div class="window-body" id="gb-body"><div style="color:var(--muted);font-family:'Pixelify Sans',monospace">Loading…</div></div>`;
    loadGuestbook();
  }});
}
async function loadGuestbook(){
  const el=document.getElementById('gb-body'); if(!el) return;
  if(!WORKER_URL){ el.innerHTML=`<div class="readonly-notice">Guestbook not configured.</div>`; return; }
  const base=WORKER_URL.replace(/\/$/,'');
  let entries=[];
  try {
    if(isAdmin()){
      let pass=''; try{ pass=sessionStorage.getItem(PW_SESSION_KEY)||''; }catch(e){}
      const r=await fetch(base+'/guestbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'list'})});
      entries=(await r.json()).entries||[];
    } else {
      const r=await fetch(base+'/guestbook');
      entries=(await r.json()).entries||[];
    }
  } catch(e){ el.innerHTML=`<div class="readonly-notice">Couldn't reach guestbook.</div>`; return; }
  renderGuestbook(entries);
}
function renderGuestbook(entries){
  const el=document.getElementById('gb-body'); if(!el) return;
  const admin=isAdmin();
  const cards = entries.length ? entries.map(e=>{
    const pending = admin && !e.approved;
    const ctrls = admin ? `<div style="margin-top:5px;display:flex;gap:4px">
        ${pending?`<button class="win-btn" style="font-size:12px;padding:0 8px" onclick="gbAction('approve','${e.id}')">approve</button>`:''}
        <button class="win-btn danger" style="font-size:12px;padding:0 8px" onclick="gbAction('delete','${e.id}')">delete</button>
      </div>` : '';
    return `<div class="gb-card${pending?' gb-pending':''}">
      <div class="gb-msg">${esc(e.message).replace(/\n/g,'<br>')}</div>
      <div class="gb-meta">— ${esc(e.name||'anon')} · ${new Date(e.ts).toLocaleDateString()}${pending?' · ⏳ pending':''}</div>
      ${ctrls}
    </div>`;
  }).join('') : `<div style="color:var(--muted);font-style:italic;font-family:'Pixelify Sans',monospace;font-size:12px">No notes yet — be the first.</div>`;
  el.innerHTML=`
    <div class="section-label" style="margin-bottom:6px">LEAVE A NOTE</div>
    <input id="gb-name" class="form-input" placeholder="your name (optional)" maxlength="40" style="margin-bottom:6px">
    <textarea id="gb-msg" class="form-input" rows="3" maxlength="280" placeholder="say hi…" style="resize:vertical;margin-bottom:6px"></textarea>
    <input id="gb-website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
    <button class="win-btn" id="gb-submit" onclick="submitGuestbook()">[ Post Note ]</button>
    <div style="font-size:11px;color:var(--muted);font-family:'Pixelify Sans',monospace;margin-top:4px">Notes appear once the host approves them.</div>
    <hr class="divider">
    <div class="section-label" style="margin-bottom:6px">NOTES${admin?' · admin sees pending':''}</div>
    <div>${cards}</div>`;
}
async function submitGuestbook(){
  const msg=document.getElementById('gb-msg')?.value.trim()||'';
  if(!msg){ toast('Write a message first'); return; }
  const base=WORKER_URL.replace(/\/$/,'');
  const btn=document.getElementById('gb-submit'); if(btn){ btn.disabled=true; btn.textContent='[ … ]'; }
  try {
    const r=await fetch(base+'/guestbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      name:document.getElementById('gb-name')?.value||'',
      message:msg,
      website:document.getElementById('gb-website')?.value||'' // honeypot
    })});
    if(r.ok){ toast('Note sent — awaiting approval ✓'); loadGuestbook(); }
    else { const e=await r.json().catch(()=>({})); toast(e.error||('Failed: '+r.status)); }
  } catch(e){ toast('Network error'); }
  finally { if(btn){ btn.disabled=false; btn.textContent='[ Post Note ]'; } }
}
async function gbAction(action,id){
  if(action==='delete' && !confirm('Delete this note?')) return;
  const base=WORKER_URL.replace(/\/$/,'');
  let pass=''; try{ pass=sessionStorage.getItem(PW_SESSION_KEY)||''; }catch(e){}
  try {
    const r=await fetch(base+'/guestbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action,id})});
    if(r.ok){ renderGuestbook((await r.json()).entries||[]); toast(action==='approve'?'Approved ✓':'Deleted'); }
    else if(r.status===401){ toast('Auth expired — log in again'); }
    else toast('Action failed');
  } catch(e){ toast('Network error'); }
}

// ── PAPER WINDOW ──────────────────────────────────────────
function openPaper(id){
  const p=papers.find(x=>x.id===id);if(!p)return;
  createWindow({id:'paper-'+id,title:p.title,icon:p.icon,width:540,height:520,statusText:`${p.venue} · ${p.year}`,buildBody:inner=>{
    inner.innerHTML=`<div class="window-body" id="pb-${id}"></div>`;
    renderPaperBody(p);
  }});
}

function renderPaperBody(p){
  const el=document.getElementById('pb-'+p.id);if(!el)return;
  const pdfBoxId='pdf-box-'+p.id;
  const safeUrl = (p.pdfUrl||'').trim();
  const urlOk   = /^https?:\/\//i.test(safeUrl);
  el.innerHTML=`
    ${!isAdmin()?`<div class="readonly-notice">🔒 View only — log in as admin to edit (local-only)</div>`:''}
    <div class="paper-layout">
      <div class="pdf-preview-box" id="${pdfBoxId}">
        <div class="pdf-placeholder">[ Loading… ]</div>
      </div>
      <div class="paper-meta-col">
        <div class="paper-title">${esc(p.title)}</div>
        <div class="paper-authors">${esc(p.authors)}</div>
        <div class="paper-venue">${esc(p.venue)} · ${esc(p.year)}</div>
        ${WORKER_URL?`<button class="win-btn" style="font-size:13px;padding:0 8px;margin-bottom:8px" onclick="copyShare('${p.id}')">🔗 Share</button>`:''}
        <div class="tags" id="tags-${p.id}">${isAdmin()?tagEditorHTML(p):(p.tags||[]).map(t=>tagHTML(t)).join('')}</div>
        <div class="section-label" style="margin-top:4px;margin-bottom:4px">Rating</div>
        <div class="stars-row" id="stars-${p.id}">${starsHTML(p.rating,p.id,isAdmin())}</div>
      </div>
    </div>
    <div class="abstract-text" style="margin-bottom:10px">${esc(p.abstract)}</div>
    <hr class="divider">
    ${isAdmin()?`
    <div class="section-label">PDF Link</div>
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <input class="form-input" id="pdfurl-${p.id}" value="${esc(safeUrl)}" placeholder="https://arxiv.org/pdf/…" style="flex:1">
      <button class="win-btn" onclick="savePdfUrl('${p.id}')">[ Set ]</button>
    </div>`:urlOk?`<div class="section-label">PDF</div><div style="font-family:'Pixelify Sans',monospace;font-size:11px;color:var(--muted);margin-bottom:10px;word-break:break-all"><a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent2)">${esc(safeUrl)}</a></div>`:''}
    <div class="section-label">Notes</div>
    ${isAdmin()?`
    <textarea class="notes-area" id="notes-${p.id}" placeholder="Write your thoughts…">${esc(p.notes||'')}</textarea>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="win-btn" onclick="saveNotes('${p.id}')">[ Save Notes ]</button>
      <button class="win-btn danger" onclick="deletePaper('${p.id}')">[ Delete ]</button>
    </div>`:
    `<div style="font-family:'Pixelify Sans',monospace;font-size:13px;line-height:1.7;color:var(--text);background:var(--input-bg);border:1px solid #c8a86040;padding:8px 10px;min-height:60px;white-space:pre-wrap">${p.notes?esc(p.notes):'<span style="color:var(--muted);font-style:italic">No notes yet.</span>'}</div>`
    }
  `;
  renderPdfPreview(p.pdfUrl, pdfBoxId);
}

function copyShare(id){
  const u = WORKER_URL.replace(/\/$/,'') + '/p/' + id;
  if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(u).then(()=>toast('Share link copied 🔗'),()=>prompt('Copy link:',u)); }
  else prompt('Copy link:',u);
}
function savePdfUrl(id){
  const p=papers.find(x=>x.id===id);if(!p)return;
  const input=document.getElementById('pdfurl-'+id);if(!input)return;
  p.pdfUrl=input.value.trim();savePapers();
  renderPdfPreview(p.pdfUrl,'pdf-box-'+id);
  toast('PDF link saved ✓');
}

function saveNotes(id){
  const p=papers.find(x=>x.id===id);if(!p)return;
  const ta=document.getElementById('notes-'+id);if(ta){p.notes=ta.value;savePapers();toast('Notes saved ✓');}
}
function setRating(id,r,el){
  const p=papers.find(x=>x.id===id);if(!p)return;
  p.rating=r;savePapers();
  const row=document.getElementById('stars-'+id);
  if(row){row.innerHTML=starsHTML(r,id);const s=[...row.querySelectorAll('.star')][r-1];if(s){s.classList.add('pop');s.addEventListener('animationend',()=>s.classList.remove('pop'),{once:true});}}
  toast('Rating saved ✓');
}
function deletePaper(id){
  if(!confirm('Remove this paper?'))return;
  papers=papers.filter(x=>x.id!==id);savePapers();closeWindow('paper-'+id);renderFolderGrid();
  const fw=openWindows['reviews'];if(fw)fw.querySelector('.window-statusbar').textContent=`${papers.length} papers · double-click to open`;
  toast('Paper removed');
}

// ── ADD PAPER ─────────────────────────────────────────────
function openAddPaper(){
  if(openWindows['add-paper']){bringToFront(openWindows['add-paper']);return;}
  createWindow({id:'add-paper',title:'Add New Paper',icon:'📄',width:420,height:520,statusText:'New entry',buildBody:inner=>{
    inner.innerHTML=`<div class="window-body">
      <div class="form-row"><label>Title *</label><input class="form-input" id="ap-title" type="text" placeholder="Full paper title…"></div>
      <div class="form-row"><label>Authors</label><input class="form-input" id="ap-authors" type="text" placeholder="Author, A., Author, B., …"></div>
      <div style="display:flex;gap:8px">
        <div class="form-row" style="flex:1"><label>Year</label><input class="form-input" id="ap-year" type="number" placeholder="2024"></div>
        <div class="form-row" style="flex:1"><label>Venue</label><input class="form-input" id="ap-venue" type="text" placeholder="NeurIPS…"></div>
      </div>
      <div class="form-row"><label>Tags (comma-separated)</label><input class="form-input" id="ap-tags" type="text" placeholder="deep learning, NLP…"></div>
      <div class="form-row"><label>Abstract</label><textarea class="form-input" id="ap-abstract" style="height:70px;resize:vertical" placeholder="Paste abstract…"></textarea></div>
      <div class="form-row"><label>PDF URL</label><input class="form-input" id="ap-pdfurl" type="url" placeholder="https://arxiv.org/pdf/…"></div>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:4px">
        <div class="form-row"><label>Icon</label><input class="form-input" id="ap-icon" type="text" value="📄" style="width:52px"></div>
        <div style="flex:1"></div>
        <button class="win-btn" style="margin-bottom:8px" onclick="submitAddPaper()">[ Add to Library ]</button>
      </div>
    </div>`;
  }});
}

function submitAddPaper(){
  const title=document.getElementById('ap-title').value.trim();
  if(!title){toast('Title is required!');return;}
  const id='p'+Date.now();
  papers.push({id,title,
    authors:document.getElementById('ap-authors').value.trim()||'Unknown',
    year:parseInt(document.getElementById('ap-year').value)||new Date().getFullYear(),
    venue:document.getElementById('ap-venue').value.trim()||'—',
    tags:document.getElementById('ap-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    abstract:document.getElementById('ap-abstract').value.trim()||'',
    rating:0,notes:'',
    icon:document.getElementById('ap-icon').value.trim()||'📄',
    pdfUrl:document.getElementById('ap-pdfurl').value.trim()||''
  });
  savePapers();renderFolderGrid();
  const fw=openWindows['reviews'];if(fw)fw.querySelector('.window-statusbar').textContent=`${papers.length} papers · double-click to open`;
  closeWindow('add-paper');toast('Paper added!');
  setTimeout(()=>openPaper(id),200);
}

// ── ABOUT / CV ────────────────────────────────────────────
function openAbout(){
  createWindow({id:'about',title:'About Me',icon:'🪪',width:480,height:560,statusText:'Click any field to edit — auto-saves',buildBody:inner=>{
    inner.innerHTML=`<div class="window-body" id="cv-body"></div>`;renderCV();
  }});
}
function renderCV(){
  const el=document.getElementById('cv-body');if(!el)return;
  const ro = !isAdmin();
  const ROFLAG = ro ? 'readonly' : '';
  el.innerHTML=`
    ${ro?`<div class="readonly-notice">🔒 View only — log in as admin to edit</div>`:''}
    <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px">
      <div style="width:60px;height:60px;background:var(--win-parch);border:2px solid var(--win-bdr);display:flex;align-items:center;justify-content:center;font-size:34px;flex-shrink:0;${ro?'':'cursor:pointer;'}box-shadow:inset 1px 1px 0 var(--btn-hi),inset -1px -1px 0 var(--btn-sh)" ${ro?'':'onclick="changeAvatar()" title="Click to change"'}>${esc(cv.avatar)}</div>
      <div style="flex:1"><input class="cv-name-input" id="cv-name" value="${esc(cv.name)}" ${ro?ROFLAG:'oninput="cv.name=this.value;saveCV()"'} placeholder="Your Name"><input class="cv-field" value="${esc(cv.role)}" ${ro?ROFLAG:'oninput="cv.role=this.value;saveCV()"'} placeholder="Role / Title" style="font-style:italic;color:var(--muted)"></div>
    </div>
    <div class="form-row"><label>Affiliation</label><input class="cv-field" value="${esc(cv.affiliation)}" ${ro?ROFLAG:'oninput="cv.affiliation=this.value;saveCV()"'}></div>
    <div class="form-row"><label>Bio</label><textarea class="cv-textarea" rows="4" ${ro?ROFLAG:'oninput="cv.bio=this.value;saveCV()"'}>${esc(cv.bio)}</textarea></div>
    <div class="form-row"><label>Research Interests</label><input class="cv-field" value="${esc(cv.interests)}" ${ro?ROFLAG:'oninput="cv.interests=this.value;saveCV()"'}></div>
    <div style="display:flex;gap:8px">
      <div class="form-row" style="flex:1"><label>Email</label><input class="cv-field" value="${esc(cv.email)}" ${ro?ROFLAG:'oninput="cv.email=this.value;saveCV()"'} type="email"></div>
      <div class="form-row" style="flex:1"><label>Website</label><input class="cv-field" value="${esc(cv.website)}" ${ro?ROFLAG:'oninput="cv.website=this.value;saveCV()"'}></div>
    </div>
    <hr class="divider">
    <div class="section-label" style="margin-bottom:8px">GitHub</div>
    ${ro?'':`<div class="form-row"><label>GitHub username</label><input class="cv-field" value="${esc(cv.github||'uuu4')}" oninput="cv.github=this.value;saveCV()" onchange="renderGitHubPanel()"></div>`}
    <div id="gh-graph" class="gh-graph-box"><div class="gh-err">loading…</div></div>
    <div class="section-label" style="margin:10px 0 6px">Recent Repos</div>
    <div id="gh-repos"><div class="gh-err">loading…</div></div>
    <hr class="divider">
    <div class="section-label" style="margin-bottom:8px">Reading Stats</div>
    <div class="stats-box">
      📚 Papers read: <b>${papers.length}</b> &nbsp;·&nbsp; ⭐ Avg rating: <b>${papers.length?(papers.reduce((s,p)=>s+(p.rating||0),0)/papers.length).toFixed(1):'—'}</b><br>
      🏷 Top tag: <b>${esc(topTag())}</b> &nbsp;·&nbsp; ✍️ With notes: <b>${papers.filter(p=>(p.notes||'').trim()).length}</b>
    </div><br>
    <button class="win-btn" onclick="closeWindow('about');toast('All saved ✓')">[ Done ]</button>
  `;
  renderGitHubPanel();
}
// Live GitHub mini-panel (public CORS APIs, no auth, no worker).
async function renderGitHubPanel(){
  const graphEl=document.getElementById('gh-graph'), reposEl=document.getElementById('gh-repos');
  if(!graphEl) return;
  const user=(cv.github||'uuu4').trim();
  try {
    const d=await (await fetch(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=last`)).json();
    const cells=(d.contributions||[]).map(c=>`<div class="gh-cell gh-l${c.level||0}" title="${esc(c.date)}: ${c.count}"></div>`).join('');
    const total=(d.total&&d.total.lastYear)||(d.contributions||[]).reduce((s,c)=>s+(c.count||0),0);
    graphEl.innerHTML=`<div class="gh-grid">${cells}</div><div class="gh-total">${total} contributions in the last year · @${esc(user)}</div>`;
  } catch(e){ graphEl.innerHTML=`<div class="gh-err">couldn't load contributions</div>`; }
  if(!reposEl) return;
  try {
    const repos=await (await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/repos?sort=updated&per_page=5&type=owner`)).json();
    reposEl.innerHTML=Array.isArray(repos)&&repos.length ? repos.map(rp=>`<a class="gh-repo" href="${esc(rp.html_url)}" target="_blank" rel="noopener noreferrer">
        <div class="gh-repo-name">📦 ${esc(rp.name)}</div>
        ${rp.description?`<div class="gh-repo-desc">${esc(rp.description)}</div>`:''}
        <div class="gh-repo-meta">${rp.language?`<span class="gh-lang">${esc(rp.language)}</span>`:''}${rp.stargazers_count?` ★ ${rp.stargazers_count}`:''}${rp.fork?' · fork':''}</div>
      </a>`).join('') : `<div class="gh-err">no public repos</div>`;
  } catch(e){ reposEl.innerHTML=`<div class="gh-err">couldn't load repos</div>`; }
}
function topTag(){const f={};papers.forEach(p=>p.tags.forEach(t=>f[t]=(f[t]||0)+1));const e=Object.entries(f).sort((a,b)=>b[1]-a[1])[0];return e?e[0]:'—';}
function changeAvatar(){const e=['🧑‍💻','👨‍🔬','👩‍🔬','🧑‍🎓','👨‍🏫','🦊','🐙','🌿','🔭','📡','🧬'];const i=e.indexOf(cv.avatar);cv.avatar=e[(i+1)%e.length];saveCV();renderCV();}

// ── MENUS ─────────────────────────────────────────────────
function toggleStartMenu(){document.getElementById('start-menu').classList.toggle('open');}
function closeStartMenu(){document.getElementById('start-menu').classList.remove('open');}
function closeCtx(){document.getElementById('ctx-menu').classList.remove('open');}
function selectIcon(id){document.querySelectorAll('.d-icon').forEach(x=>x.classList.remove('selected'));document.getElementById(id)?.classList.add('selected');}

document.getElementById('desktop').addEventListener('contextmenu',e=>{e.preventDefault();const m=document.getElementById('ctx-menu');m.style.left=e.clientX+'px';m.style.top=Math.min(e.clientY,window.innerHeight-140)+'px';const ni=document.getElementById('ctx-note-item');if(ni)ni.style.display=isAdmin()?'block':'none';m.classList.add('open');});
document.addEventListener('click',()=>{closeCtx();closeStartMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCtx();closeStartMenu();}});

// ── PREFERENCES ───────────────────────────────────────────
const PREFS_KEY = 'pl-prefs';
let prefs = (()=>{ try{ return JSON.parse(lsGet(PREFS_KEY)||'null') || {}; }catch(e){return {};} })();
prefs = { theme:'parchment', scanlines:true, sounds:true, winSize:'medium', deskPattern:'solid', ...prefs };
delete prefs.barrel;
function savePrefs(){ lsSet(PREFS_KEY, JSON.stringify(prefs)); }

const THEMES = {
  parchment:     {'--desk':'#17110b','--desk-line':'#261d14','--win-bg':'#f3e8cc','--win-parch':'#ede0bc','--win-bdr':'#1a1008','--tb-from':'#1c120a','--tb-to':'#0e0a06','--tb-txt':'#e8c060','--btn':'#d8c8a0','--btn-hi':'#f0e4c0','--btn-sh':'#7a6030','--text':'#1e1408','--muted':'#5a4828','--accent':'#c87820','--input-bg':'#faf4e4','--bar':'#0e0a06','--bar-txt':'#c8a848','--folder-bg':'#e8d8b0'},
  phosphorGreen: {'--desk':'#000800','--desk-line':'#001400','--win-bg':'#001a00','--win-parch':'#002200','--win-bdr':'#00cc33','--tb-from':'#003300','--tb-to':'#001a00','--tb-txt':'#00ff41','--btn':'#004400','--btn-hi':'#006600','--btn-sh':'#00aa20','--text':'#00ff41','--muted':'#009920','--accent':'#00ff41','--input-bg':'#001200','--bar':'#000400','--bar-txt':'#00ff41','--folder-bg':'#001800'},
  phosphorAmber: {'--desk':'#0a0600','--desk-line':'#150c00','--win-bg':'#1c1000','--win-parch':'#221400','--win-bdr':'#cc8800','--tb-from':'#2a1800','--tb-to':'#1a0e00','--tb-txt':'#ffaa00','--btn':'#3a2200','--btn-hi':'#503000','--btn-sh':'#aa6600','--text':'#ffaa00','--muted':'#aa6600','--accent':'#ffaa00','--input-bg':'#130e00','--bar':'#050300','--bar-txt':'#ffaa00','--folder-bg':'#1a1000'},
  moonlight:     {'--desk':'#0f0e1a','--desk-line':'#1a1830','--win-bg':'#e8e4f8','--win-parch':'#ddd8f0','--win-bdr':'#2a2050','--tb-from':'#2a2050','--tb-to':'#1a1440','--tb-txt':'#c0a8f0','--btn':'#c0b8e0','--btn-hi':'#d8d0f0','--btn-sh':'#6050a0','--text':'#1a1440','--muted':'#6050a0','--accent':'#8060d0','--input-bg':'#f0eeff','--bar':'#0a0820','--bar-txt':'#c0a8f0','--folder-bg':'#dcd8ee'},
  slate:         {'--desk':'#0d1117','--desk-line':'#161b22','--win-bg':'#e6edf3','--win-parch':'#d8e2ed','--win-bdr':'#1c2128','--tb-from':'#1c2128','--tb-to':'#0d1117','--tb-txt':'#79c0ff','--btn':'#c0cad6','--btn-hi':'#d8e4f0','--btn-sh':'#404a56','--text':'#1c2128','--muted':'#404a56','--accent':'#2f81f7','--input-bg':'#f0f6fc','--bar':'#010409','--bar-txt':'#79c0ff','--folder-bg':'#ccd8e4'},
  terminal:      {'--desk':'#0c0c0c','--desk-line':'#1a1a1a','--win-bg':'#1e1e1e','--win-parch':'#252525','--win-bdr':'#444','--tb-from':'#2d2d2d','--tb-to':'#1a1a1a','--tb-txt':'#cccccc','--btn':'#3c3c3c','--btn-hi':'#505050','--btn-sh':'#888','--text':'#d4d4d4','--muted':'#888','--accent':'#569cd6','--input-bg':'#161616','--bar':'#0a0a0a','--bar-txt':'#cccccc','--folder-bg':'#252525'},
};
const THEME_META = {
  parchment:     {label:'Parchment',      swatch:'#f3e8cc', dark:false},
  phosphorGreen: {label:'Phosphor Green', swatch:'#001a00', dark:true},
  phosphorAmber: {label:'Phosphor Amber', swatch:'#1c1000', dark:true},
  moonlight:     {label:'Moonlight',      swatch:'#e8e4f8', dark:false},
  slate:         {label:'Slate',          swatch:'#e6edf3', dark:false},
  terminal:      {label:'Terminal Dark',  swatch:'#1e1e1e', dark:true},
};

function applyTheme(name){
  const t = THEMES[name] || THEMES.parchment;
  const root = document.documentElement;
  Object.entries(t).forEach(([k,v])=>root.style.setProperty(k,v));
  // Secondary accent: a teal "pop" only on parchment; other themes collapse to their own accent.
  root.style.setProperty('--accent2', name==='parchment' ? '#1f7a8c' : (t['--accent']||'#1f7a8c'));
}


function applyScanlines(on){ document.body.classList.toggle('scanlines-off',!on); }

// ── UI SOUNDS (Web Audio API — no files needed) ────────────
const _sfx = (typeof AudioContext !== 'undefined') ? new AudioContext() : null;
function playSound(type){
  if(!prefs.sounds || !_sfx) return;
  if(_sfx.state==='suspended') _sfx.resume();
  const osc=_sfx.createOscillator(), g=_sfx.createGain();
  osc.connect(g); g.connect(_sfx.destination);
  const t=_sfx.currentTime;
  if(type==='open'){
    osc.type='sine';
    osc.frequency.setValueAtTime(380,t);
    osc.frequency.linearRampToValueAtTime(760,t+0.07);
    g.gain.setValueAtTime(0.13,t); g.gain.linearRampToValueAtTime(0,t+0.10);
    osc.start(t); osc.stop(t+0.10);
  } else if(type==='close'){
    osc.type='sine';
    osc.frequency.setValueAtTime(520,t);
    osc.frequency.linearRampToValueAtTime(180,t+0.08);
    g.gain.setValueAtTime(0.11,t); g.gain.linearRampToValueAtTime(0,t+0.10);
    osc.start(t); osc.stop(t+0.10);
  } else if(type==='minimize'){
    osc.type='triangle';
    osc.frequency.setValueAtTime(440,t);
    osc.frequency.linearRampToValueAtTime(280,t+0.05);
    g.gain.setValueAtTime(0.09,t); g.gain.linearRampToValueAtTime(0,t+0.07);
    osc.start(t); osc.stop(t+0.07);
  } else if(type==='click'){
    osc.type='square';
    osc.frequency.setValueAtTime(1100,t);
    g.gain.setValueAtTime(0.07,t); g.gain.linearRampToValueAtTime(0,t+0.022);
    osc.start(t); osc.stop(t+0.022);
  }
}

// ── FONT ──────────────────────────────────────────────────
// ── DESKTOP PATTERN ────────────────────────────────────────
function applyDeskPattern(name){
  const b=document.body;
  b.style.backgroundSize='';
  if(name==='grid'){
    b.style.backgroundImage=`repeating-linear-gradient(var(--desk-line) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,var(--desk-line) 0 1px,transparent 1px 28px)`;
  } else if(name==='dots'){
    b.style.backgroundImage=`radial-gradient(circle,var(--desk-line) 1.5px,transparent 1.5px)`;
    b.style.backgroundSize='20px 20px';
  } else if(name==='lines'){
    b.style.backgroundImage=`repeating-linear-gradient(to bottom,transparent 0px,transparent 5px,var(--desk-line) 5px,var(--desk-line) 6px)`;
  } else {
    // solid + gentle warm radial so the desktop has depth instead of flat black
    b.style.backgroundImage='radial-gradient(ellipse 120% 95% at 50% 16%, rgba(214,170,92,0.07), transparent 72%)';
  }
}

function applyPrefs(){
  applyTheme(prefs.theme);
  applyScanlines(prefs.scanlines);
  applyDeskPattern(prefs.deskPattern);

}

// ── STICKY NOTE ───────────────────────────────────────────
function renderStickyNote(){
  const el = document.getElementById('sticky-note');
  if(!el) return;
  if(!stickyNote && !isAdmin()){
    el.classList.add('hidden'); return;
  }
  el.classList.remove('hidden');
  // Restore saved position
  const pos = (() => { try { return JSON.parse(localStorage.getItem('pl-note-pos')||'null'); } catch(e){ return null; } })();
  if(pos){ el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; }
  else { el.style.left='calc(100vw - 290px)'; el.style.top='60px'; }

  const editBtn = isAdmin()
    ? `<button class="sticky-edit-btn" onclick="openStickyEditor()">[ edit note ]</button>`
    : '';
  el.innerHTML = `<div class="sticky-text">${esc(stickyNote||'').replace(/\n/g,'<br>')}</div>${editBtn}`;

  // Make draggable (independent of window system)
  let dragging=false, ox=0, oy=0;
  el.addEventListener('mousedown', e=>{
    if(e.target.classList.contains('sticky-edit-btn')) return;
    dragging=true; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop;
    el.style.zIndex=60; e.preventDefault();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    el.style.left=Math.max(0,e.clientX-ox)+'px';
    el.style.top=Math.max(0,e.clientY-oy)+'px';
  });
  document.addEventListener('mouseup', ()=>{
    if(!dragging) return;
    dragging=false;
    try { localStorage.setItem('pl-note-pos', JSON.stringify({x:el.offsetLeft,y:el.offsetTop})); } catch(e){}
  });
}

function openStickyEditor(){
  if(!isAdmin()) return;
  createWindow({id:'sticky-editor',title:'Sticky Note',icon:'📝',width:360,height:280,
    statusText:'Publish to make visible to visitors',
    buildBody:inner=>{
      inner.innerHTML=`<div class="window-body">
        <div class="section-label" style="margin-bottom:8px">NOTE TEXT</div>
        <textarea class="form-input" id="sticky-textarea" rows="7"
          style="width:100%;resize:vertical;font-family:'Pixelify Sans',monospace;font-size:13px;line-height:1.5"
          placeholder="Write a short note for your visitors…">${esc(stickyNote)}</textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="win-btn" onclick="saveStickyDraft()">[ Save Draft ]</button>
          <button class="win-btn" style="color:var(--muted);font-size:12px"
            onclick="stickyNote='';saveNote();renderStickyNote();closeWindow('sticky-editor');toast('Note cleared')">
            [ Clear ]
          </button>
        </div>
        <div style="margin-top:8px;font-family:'Pixelify Sans',monospace;font-size:11px;color:var(--muted)">
          Publish via 🚀 Publish to make it visible to everyone.
        </div>
      </div>`;
  }});
}
function saveStickyDraft(){
  const ta=document.getElementById('sticky-textarea'); if(!ta) return;
  stickyNote=ta.value;
  saveNote();
  renderStickyNote();
  closeWindow('sticky-editor');
  toast('Note saved — Publish to go live');
}

// ── PREFERENCES WINDOW ────────────────────────────────────
function openPreferences(){
  createWindow({id:'prefs',title:'Preferences',icon:'⚙',width:460,height:620,statusText:'Changes apply instantly · saved locally',buildBody:inner=>{
    inner.innerHTML=`<div class="window-body"><div id="prefs-body"></div></div>`;
    renderPrefsBody();
  }});
}

function renderPrefsBody(){
  const el=document.getElementById('prefs-body'); if(!el) return;
  el.innerHTML=`
    <div class="section-label" style="margin-bottom:10px">COLOR THEME</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:16px">
      ${Object.entries(THEME_META).map(([k,m])=>`
        <div onclick="prefs.theme='${k}';applyTheme('${k}');savePrefs();renderPrefsBody()"
          style="display:flex;align-items:center;gap:8px;padding:7px 10px;
          border:1px solid ${prefs.theme===k?'var(--accent)':'var(--btn-sh)'};
          background:${prefs.theme===k?'rgba(200,120,32,.13)':'transparent'};
          cursor:pointer;font-family:'Pixelify Sans',monospace;font-size:15px;color:var(--text)">
          <span style="width:20px;height:20px;background:${m.swatch};border:1px solid var(--btn-sh);display:inline-block;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)"></span>
          ${esc(m.label)}${prefs.theme===k?' ✓':''}
        </div>`).join('')}
    </div>
    <hr class="divider">
    <div class="section-label" style="margin:12px 0 8px">DESKTOP PATTERN</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px">
      ${['solid','grid','dots','lines'].map(p=>`
        <button class="win-btn" onclick="prefs.deskPattern='${p}';applyDeskPattern('${p}');savePrefs();renderPrefsBody()"
          style="${prefs.deskPattern===p?'outline:1px solid var(--accent);outline-offset:1px':''}">
          [ ${p} ]
        </button>`).join('')}
    </div>
    <hr class="divider">
    <div class="section-label" style="margin:12px 0 8px">WINDOWS</div>
    <div class="form-row">
      <label>Default Window Size</label>
      <div style="display:flex;gap:5px;margin-top:4px">
        ${['small','medium','large'].map(s=>`
          <button class="win-btn" onclick="prefs.winSize='${s}';savePrefs();renderPrefsBody()"
            style="${prefs.winSize===s?'outline:1px solid var(--accent);outline-offset:1px':''}">
            [ ${s} ]
          </button>`).join('')}
      </div>
    </div>
    <hr class="divider" style="margin-top:12px">
    <div class="section-label" style="margin:12px 0 8px">DISPLAY</div>
    <div class="form-row" style="display:flex;align-items:center;gap:12px">
      <label style="margin:0;flex:1">CRT Scanlines</label>
      <button class="win-btn" onclick="prefs.scanlines=!prefs.scanlines;applyScanlines(prefs.scanlines);savePrefs();renderPrefsBody()"
        style="${prefs.scanlines?'outline:1px solid var(--accent);outline-offset:1px':''}">
        [ ${prefs.scanlines?'ON':'OFF'} ]
      </button>
    </div>
    <div class="form-row" style="display:flex;align-items:center;gap:12px;margin-top:10px">
      <label style="margin:0;flex:1">UI Sounds</label>
      <button class="win-btn" onclick="prefs.sounds=!prefs.sounds;savePrefs();playSound('click');renderPrefsBody()"
        style="${prefs.sounds?'outline:1px solid var(--accent);outline-offset:1px':''}">
        [ ${prefs.sounds?'ON':'OFF'} ]
      </button>
    </div>
    <hr class="divider" style="margin-top:14px">
    <div style="margin-top:10px;font-family:'Pixelify Sans',monospace;font-size:11px;color:var(--muted)">
      Preferences are saved in your browser. Right-click the desktop to reopen this window.
    </div>`;
}

(async()=>{
  updateAdminBadge();
  await bootData();
  applyPrefs();
  setTimeout(()=>openReviews(),200);
  const deepId=new URLSearchParams(location.search).get('paper');
  if(deepId && papers.some(p=>p.id===deepId)) setTimeout(()=>openPaper(deepId),400);
  if(!_lsOk) setTimeout(()=>toast('⚠ Storage disabled — changes won\'t persist'),1200);
  if(!remoteSnapshot) setTimeout(()=>toast('ℹ data.json not found — showing defaults'),1600);
})();

// ── SCREENSAVER ───────────────────────────────────────────
(()=>{
  const IDLE_MS = 2 * 60 * 1000; // 2 dakika
  let idleTimer, ssEl=null;

  function resetIdle(){
    clearTimeout(idleTimer);
    if(ssEl) dismissSS();
    idleTimer = setTimeout(startSS, IDLE_MS);
  }

  function startSS(){
    if(ssEl) return;
    ssEl = document.createElement('div'); ssEl.id='screensaver';
    const txt = document.createElement('div'); txt.id='screensaver-text';
    txt.textContent = 'personaOS';
    ssEl.appendChild(txt);
    document.body.appendChild(ssEl);

    let x=Math.random()*(window.innerWidth-160);
    let y=Math.random()*(window.innerHeight-40);
    let vx=(Math.random()<0.5?1:-1)*(1.4+Math.random());
    let vy=(Math.random()<0.5?1:-1)*(1.2+Math.random());
    const COLORS=['#00ff41','#ff44ff','#44ffff','#ffaa00','#ff4444','#4488ff'];
    let ci=0;

    const raf=()=>{
      if(!ssEl){return;}
      x+=vx; y+=vy;
      const W=window.innerWidth, H=window.innerHeight;
      const tw=txt.offsetWidth||140, th=txt.offsetHeight||36;
      if(x<=0||x+tw>=W){ vx*=-1; x=Math.max(0,Math.min(W-tw,x)); ci=(ci+1)%COLORS.length; txt.style.color=COLORS[ci]; txt.style.textShadow=`0 0 10px ${COLORS[ci]}`; }
      if(y<=0||y+th>=H){ vy*=-1; y=Math.max(0,Math.min(H-th,y)); ci=(ci+1)%COLORS.length; txt.style.color=COLORS[ci]; txt.style.textShadow=`0 0 10px ${COLORS[ci]}`; }
      txt.style.left=x+'px'; txt.style.top=y+'px';
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    ssEl.addEventListener('click', dismissSS);
  }

  function dismissSS(){
    if(!ssEl) return;
    ssEl.remove(); ssEl=null;
    resetIdle();
  }

  ['mousemove','mousedown','keydown','touchstart','scroll'].forEach(ev=>
    document.addEventListener(ev, resetIdle, {passive:true})
  );
  resetIdle();
})();

// ── HACKER MODE ───────────────────────────────────────────
// A reskin, not a second OS: toggles a body class + reuses createWindow.
const ACCESS_GRANTED = `<span class="t-ok">
  ╔══════════════════════════════════╗
  ║   A C C E S S   G R A N T E D    ║
  ╚══════════════════════════════════╝</span>
<span class="t-dim">decrypting filesystem............ done
mounting /root/classified........ done
spawning desktop node............ done</span>
<span class="t-ok">a hidden icon appeared on your desktop.</span>
<span class="t-dim">try:  decrypt   ·   lock (to undo)</span>`;

const SECRET_NOTE = `&gt; ACCESS LEVEL: ROOT
&gt; /root/classified/readme.txt

so you actually found it. respect.

stuff that doesn't make the front page:
  · i refactor when i should be sleeping
  · the olympiad grind is 50% ego, 50% love
  · every paper in here rewired how i think, a little

if you're reading this, you went digging for it.
that says something about you too — we'd probably
get along.

  // type 'decrypt' in the terminal for one more thing
  // 'lock' puts the lights back

— ae · personaOS`;

const DECRYPTED = `<span class="t-ok">DECRYPTING...</span>
<span class="t-dim">key accepted.</span>

"the best code is the code you never had to write."

<span class="t-dim">p.s. you read the source. that's rare.
say hi in the guestbook · github.com/uuu4</span>`;

let _matrixRAF = null;
function startMatrix(){
  const c = document.getElementById('matrix'); if(!c) return;
  const ctx = c.getContext('2d');
  const fit = ()=>{ c.width=window.innerWidth; c.height=window.innerHeight; };
  fit(); window.addEventListener('resize', fit);
  const glyphs = 'アカサタナハマヤラワ0123456789ABCDEF<>/*$#';
  const step = 16;
  let drops = Array(Math.ceil(c.width/step)).fill(0).map(()=>Math.random()*-50);
  let last = 0;
  function draw(t){
    if(!document.body.classList.contains('hacker')){ _matrixRAF=null; return; }
    if(t-last > 55){ // ~18fps — cheap
      last = t;
      ctx.fillStyle = 'rgba(0,8,0,0.16)'; ctx.fillRect(0,0,c.width,c.height);
      ctx.fillStyle = '#00ff5a'; ctx.font = '14px monospace';
      const cols = Math.ceil(c.width/step);
      if(drops.length!==cols) drops = Array(cols).fill(0).map((_,i)=>drops[i]||0);
      for(let i=0;i<cols;i++){
        ctx.fillText(glyphs[Math.floor(Math.random()*glyphs.length)], i*step, drops[i]*step);
        drops[i] = (drops[i]*step > c.height && Math.random()>0.975) ? 0 : drops[i]+1;
      }
    }
    _matrixRAF = requestAnimationFrame(draw);
  }
  if(_matrixRAF) cancelAnimationFrame(_matrixRAF);
  _matrixRAF = requestAnimationFrame(draw);
}
function hackerSound(){
  if(!prefs.sounds || !_sfx) return;
  if(_sfx.state==='suspended') _sfx.resume();
  [392,523,659,784].forEach((f,i)=>{
    const o=_sfx.createOscillator(), g=_sfx.createGain(), t=_sfx.currentTime+i*0.09;
    o.type='square'; o.frequency.setValueAtTime(f,t);
    g.gain.setValueAtTime(0.06,t); g.gain.linearRampToValueAtTime(0,t+0.09);
    o.connect(g); g.connect(_sfx.destination); o.start(t); o.stop(t+0.09);
  });
}
function activateHacker(){
  if(document.body.classList.contains('hacker')) return;
  document.body.classList.add('hacker');
  startMatrix();
  hackerSound();
  toast('⛓ ACCESS GRANTED');
}
function deactivateHacker(){
  document.body.classList.remove('hacker'); // matrix loop self-stops
  closeWindow('classified');
  toast('systems re-secured');
}
function openClassified(){
  createWindow({id:'classified',title:'/root/classified',icon:'🔓',width:440,height:400,
    statusText:'TOP SECRET · self-destructs on refresh',buildBody:inner=>{
      inner.innerHTML=`<div class="window-body" style="white-space:pre-wrap;line-height:1.7;font-size:14px;color:var(--text)">${SECRET_NOTE}</div>`;
  }});
}

// ── HIDDEN TERMINAL (` key) ──────────────────────────────
(()=>{
  const CMDS = {
    help: ()=>`<span class="t-ok">PERSONA/OS Terminal v1.0</span>
<span class="t-dim">─────────────────────────────</span>
  help          show this list
  ls            list papers
  whoami        who you are
  pwd           where you are
  date          date and time
  cat readme    about this OS
  sudo          give it a shot
  rm -rf thesis didn't even dare
  coffee        ☕
  clear         clear the screen
<span class="t-dim">─────────────────────────────
  [ 1 command not listed — earn it ]</span>`,

    ls: ()=>{
      if(!papers||!papers.length) return '<span class="t-dim">[ no papers found ]</span>';
      return papers.map((p,i)=>`<span class="t-dim">${String(i+1).padStart(2,'0')}</span>  ${p.title} <span class="t-dim">(${p.year})</span>`).join('\n');
    },

    whoami: ()=>`<span class="t-ok">${cv?.name||'unknown'}</span> — ${cv?.role||'researcher'}`,
    pwd:    ()=>'/home/personaos/papers',
    date:   ()=>new Date().toLocaleString('en-US'),
    coffee: ()=>`<span class="t-ok">☕ brewing</span>\n<span class="t-dim">...........\ndone. did you like it?</span>`,
    clear:  ()=>'__CLEAR__',
    'cat readme': ()=>`personaOS — retro desktop paper library
written by: you
version: 1.0.0
license: not much of one`,
    'sudo make coffee': ()=>`[sudo] password: ****\n<span class="t-err">ERROR: coffee pot not found in /dev</span>`,
    'sudo rm -rf /': ()=>`<span class="t-err">easy there, buddy.</span>`,
    'rm -rf thesis': ()=>`<span class="t-err">rm: cannot remove 'thesis': Too much pain attached</span>`,
    sudo: ()=>`<span class="t-err">this is a terminal easter egg, sudo isn't real 😌</span>`,
    'sudo unlock': ()=>{ activateHacker(); return ACCESS_GRANTED; },
    unlock:        ()=>{ activateHacker(); return ACCESS_GRANTED; },
    decrypt: ()=> document.body.classList.contains('hacker') ? DECRYPTED : `<span class="t-err">decrypt: nothing to decrypt — system locked.</span>`,
    lock: ()=>{ if(!document.body.classList.contains('hacker')) return `<span class="t-dim">already locked.</span>`; deactivateHacker(); return `<span class="t-dim">re-securing... lights off.</span>`; },
    exit: ()=>'__EXIT__',
    quit: ()=>'__EXIT__',
  };

  function runCmd(raw, outEl){
    const cmd = raw.trim().toLowerCase();
    if(!cmd) return;
    // echo input
    outEl.innerHTML += `\n<span class="t-dim">❯</span> ${raw}\n`;
    const fn = CMDS[cmd] || (()=>`<span class="t-err">command not found: ${raw}\ntype 'help' for a list</span>`);
    const result = fn();
    if(result==='__CLEAR__'){ outEl.innerHTML=''; return; }
    if(result==='__EXIT__'){ closeWindow('terminal'); return; }
    outEl.innerHTML += result + '\n';
    outEl.scrollTop = outEl.scrollHeight;
  }

  function openTerminal(){
    createWindow({id:'terminal', title:'Terminal', icon:'🖥', width:520, height:360,
      statusText:'backtick (`) to toggle · exit to quit',
      buildBody: inner=>{
        inner.style.display='flex'; inner.style.flexDirection='column';
        inner.style.background='#000'; inner.style.height='100%';
        const out = document.createElement('div'); out.id='terminal-output';
        out.innerHTML=`<span class="t-ok">PERSONA/OS Terminal</span> — <span class="t-dim">type 'help' to get started</span>\n`;
        const row = document.createElement('div'); row.id='terminal-input-row';
        row.innerHTML=`<span>❯</span><input id="terminal-input" autocomplete="off" spellcheck="false" autofocus placeholder="enter command...">`;
        inner.appendChild(out); inner.appendChild(row);
        const inp = row.querySelector('#terminal-input');
        inp.addEventListener('keydown', e=>{
          if(e.key==='Enter'){ runCmd(inp.value, out); inp.value=''; e.preventDefault(); }
        });
        setTimeout(()=>inp.focus(), 80);
      }
    });
  }

  window.openTerminal = openTerminal; // desktop icon / start menu entry point

  document.addEventListener('keydown', e=>{
    if(e.key==='`'&&!e.ctrlKey&&!e.metaKey){
      const focused = document.activeElement;
      if(focused&&(focused.tagName==='INPUT'||focused.tagName==='TEXTAREA')) return;
      e.preventDefault();
      if(openWindows['terminal']) closeWindow('terminal');
      else openTerminal();
    }
  });
})();
