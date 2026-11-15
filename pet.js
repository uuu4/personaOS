/* Desktop pet: a small teal blob. 16x16 frames authored as strings, rendered by zine.js (canvas) and by node for the gif. */
const PET_PAL = { b: '#1f7a8c', d: '#145867', a: '#c87820', w: '#f3e8cc', k: '#17110b', p: '#e0607e' };
const PET_BODY = [ // stand, facing right; rows 0..15
  '................', '................', '................', '................',
  '.....aa...aa....',
  '....bbbbbbbbb...',
  '...bbbbbbbbbbb..',
  '..bbbbbbbbbbbbb.',
  '..bbbbbbwkbbwkb.',
  '.abbbbbbbbbbbbb.',
  '.abbbbbbbbbbbbb.',
  '..bbbbbbbbbbbbb.',
  '...ddddddddddd..',
  '................', '................', '................',
];
const PET_LEGS = { // row 13 overlays
  a: '...dd......dd...', b: '......dddd......', c: '....dd....dd....', s: '....dd.....dd...', none: '................',
};
const PET_GLYPH = { // small overlays: [x,y,rows]
  heart: ['.p.p.', 'ppppp', '.ppp.', '..p..'],
  z1: ['www', '..w', '.w.', 'www'],
  z2: ['wwww', '...w', '..w.', '.w..', 'wwww'],
  bang: ['k', 'k', 'k', '.', 'k'],
};
function petFrame(o) { // o: {dy, legs, eyes:'open'|'blink'|'closed'|'happy', tail:0|1, glyph:[name,x,y]}
  o = o || {}; const OFF = 4, dy = (o.dy || 0) + OFF, g = Array.from({ length: 20 }, () => Array(16).fill('.'));
  const put = (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 20 && c !== '.') g[y][x] = c; };
  PET_BODY.forEach((row, y) => { if (y > 3 && y < 13) [...row].forEach((c, x) => put(x, y + dy, c)); });
  const eye = (cx) => { // cx = x of the white pixel
    if (o.eyes === 'blink') { put(cx, 8 + dy, 'b'); put(cx + 1, 8 + dy, 'b'); put(cx, 9 + dy, 'k'); put(cx + 1, 9 + dy, 'k'); }
    else if (o.eyes === 'closed') { put(cx, 8 + dy, 'b'); put(cx + 1, 8 + dy, 'b'); put(cx, 9 + dy, 'k'); put(cx + 1, 9 + dy, 'k'); }
    else if (o.eyes === 'happy') { put(cx, 9 + dy, 'k'); put(cx + 1, 8 + dy, 'k'); put(cx + 2, 9 + dy, 'k'); put(cx, 8 + dy, 'b'); put(cx + 1, 9 + dy, 'b'); }
  };
  if (o.eyes && o.eyes !== 'open') { eye(8); eye(12); }
  if (o.tail) { put(0, 8 + dy, 'a'); put(1, 9 + dy, 'b'); put(0, 9 + dy, 'a'); put(1, 10 + dy, 'b'); put(1, 9 + dy, 'a'); }
  const legs = PET_LEGS[o.legs || 'none']; [...legs].forEach((c, x) => put(x, 13 + dy, c));
  if (o.glyph) { const gl = PET_GLYPH[o.glyph[0]]; gl.forEach((row, yy) => [...row].forEach((c, xx) => put(o.glyph[1] + xx, o.glyph[2] + yy, c))); }
  return g.map(r => r.join(''));
}
const PET_FRAMES = {
  walk: [petFrame({ legs: 'a' }), petFrame({ legs: 'b', dy: -1 }), petFrame({ legs: 'c' }), petFrame({ legs: 'b', dy: -1 })],
  idle: [petFrame({ legs: 's' }), petFrame({ legs: 's', eyes: 'blink' })],
  sit: [petFrame({ dy: 1, legs: 's' }), petFrame({ dy: 1, legs: 's', tail: 1 })],
  sleep: [petFrame({ dy: 1, eyes: 'closed', legs: 's', glyph: ['z1', 11, 1] }), petFrame({ dy: 1, eyes: 'closed', legs: 's', glyph: ['z2', 11, 0] })],
  hop: [petFrame({ dy: -1, legs: 'b', eyes: 'happy', glyph: ['heart', 9, 0] }), petFrame({ dy: -3, legs: 'none', eyes: 'happy', glyph: ['heart', 9, 0] }), petFrame({ dy: -1, legs: 'b', eyes: 'happy', glyph: ['heart', 9, 0] }), petFrame({ dy: 0, legs: 'a', eyes: 'happy', glyph: ['heart', 9, 0] })],
};
function petDraw(ctx, frame) { ctx.clearRect(0, 0, 16, 20); frame.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') { ctx.fillStyle = PET_PAL[c]; ctx.fillRect(x, y, 1, 1); } })); }
if (typeof module !== 'undefined') module.exports = { PET_PAL, PET_FRAMES };
