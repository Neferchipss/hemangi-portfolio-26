'use strict';
// Hemangi's picture house. Content (reel titles, taglines and the media shown on the screen)
// lives in content.json and is edited through /admin. Reel ids map to the tin art in assets/.

const FALLBACK = {
  site: { name: 'Hemangi', tagline: 'a collection of things I make, do & obsess over', about: '', email: '', links: [] },
  reels: [
    { id: 'singing', act: 'Prequel', title: 'Singing', tagline: '', items: [] },
    { id: 'painting', act: 'Act 1', title: 'Painting', tagline: '', items: [] },
    { id: 'craft', act: 'Act 2', title: 'Art, Craft & Clay', tagline: '', items: [] },
    { id: 'fashion', act: 'Sequel', title: 'Fashion', tagline: '', items: [] },
    { id: 'brewing', act: 'The Spin-off', title: 'Brewing', tagline: '', items: [] }
  ]
};
const reelArt = id => `assets/reel-${id}.webp`;

const $ = id => document.getElementById(id);
const cinema = $('cinema'), stage = $('stage'), screen = $('screen'), projector = $('projector'), shelf = $('shelf');
const scenes = { welcome: $('welcome'), leader: $('leader'), titlecard: $('titlecard'), player: $('player') };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 60) : ms));

// The five portraits trade places at irregular intervals while the welcome card is showing.
const welcomePoses = [...document.querySelectorAll('.welcome-pose')];
const poseSlots = [11, 30, 49, 68, 87];
const poseOrder = [0, 1, 2, 3, 4];
function shuffleWelcomePoses() {
  if (!scenes.welcome.hidden && !document.hidden) {
    const first = Math.floor(Math.random() * poseOrder.length);
    let second = Math.floor(Math.random() * (poseOrder.length - 1));
    if (second >= first) second++;
    [poseOrder[first], poseOrder[second]] = [poseOrder[second], poseOrder[first]];
    welcomePoses.forEach((pose, i) => {
      pose.style.setProperty('--pose-x', `${poseSlots[poseOrder[i]]}%`);
      pose.style.setProperty('--pose-tilt', `${(Math.random() * 9 - 4.5).toFixed(1)}deg`);
      pose.style.setProperty('--pose-scale', (0.94 + Math.random() * 0.09).toFixed(3));
    });
  }
  setTimeout(shuffleWelcomePoses, 3800 + Math.random() * 3800);
}
if (!reduced) setTimeout(shuffleWelcomePoses, 3800 + Math.random() * 2500);

let content = FALLBACK;
let active = null;      // reel currently on the projector
let index = 0;          // item index within the active reel
let run = 0;            // bumps on every load/eject so stale async steps bail out
let drag = null, suppressClick = false, idleTimer = 0, previewing = false;

// ---------- sizing: --u is 1% of the rendered stage width ----------
new ResizeObserver(() => {
  stage.style.setProperty('--u', stage.getBoundingClientRect().width / 100 + 'px');
  cinema.style.setProperty('--u', cinema.getBoundingClientRect().width / 100 + 'px');
}).observe(stage);

// ---------- content ----------
async function loadContent() {
  if (new URLSearchParams(location.search).has('preview')) {
    // Admin preview: the admin page posts the draft (including not-yet-uploaded files as blob URLs).
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.data?.type !== 'hp-preview') return;
      previewing = true;
      content = normalise(e.data.content);
      applyContent();
      const again = active && content.reels.find(r => r.id === active.id);
      if (again) {
        const hadNone = !active.items.length;
        active = again; index = Math.min(index, Math.max(0, active.items.length - 1));
        if (!scenes.player.hidden) { if (active.items.length) showItem(index); else play(active.id); }
        else if (hadNone && active.items.length && !scenes.titlecard.hidden) play(active.id);
      }
    });
    window.parent?.postMessage({ type: 'hp-preview-ready' }, location.origin);
  }
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (res.ok && !previewing) content = normalise(await res.json());
    else if (previewing) return;
  } catch { /* offline or file:// — keep fallback */ }
  applyContent();
}
function normalise(c) {
  const byId = Object.fromEntries((c?.reels || []).map(r => [r.id, r]));
  return {
    site: { ...FALLBACK.site, ...(c?.site || {}) },
    reels: FALLBACK.reels.map(base => ({ ...base, ...(byId[base.id] || {}), items: (byId[base.id]?.items || []).filter(i => i && i.src) }))
  };
}
function applyContent() {
  const s = content.site;
  $('credits-name').textContent = s.name || 'Hemangi';
  $('credits-about').textContent = s.about || '';
  const list = $('credits-list'); list.replaceChildren();
  content.reels.forEach(r => {
    const dt = document.createElement('dt'); dt.textContent = r.act;
    const dd = document.createElement('dd'); dd.textContent = r.title;
    list.append(dt, dd);
  });
  const links = $('credits-links'); links.replaceChildren();
  if (s.email) links.append(link(`mailto:${s.email}`, s.email));
  (s.links || []).filter(l => l.url).forEach(l => links.append(link(l.url, l.label || l.url)));
  buildShelf();
}
function link(href, text) {
  const a = document.createElement('a'); a.href = href; a.textContent = text;
  if (!href.startsWith('mailto:')) { a.target = '_blank'; a.rel = 'noopener'; }
  return a;
}

// ---------- shelf ----------
function buildShelf() {
  shelf.replaceChildren();
  content.reels.forEach(reel => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'reel'; b.dataset.id = reel.id;
    b.setAttribute('aria-label', `${reel.act}: ${reel.title}. Drag to the projector or press to play.`);
    b.innerHTML = `<img src="${reelArt(reel.id)}" alt="" draggable="false"><span class="reel-tag">now showing</span>`;
    b.classList.toggle('on-projector', active?.id === reel.id);
    b.addEventListener('click', () => { if (!suppressClick) play(reel.id, b); });
    b.addEventListener('pointerdown', e => beginDrag(e, b, reel));
    shelf.append(b);
  });
}

// ---------- screen states ----------
function show(name) { for (const [k, el] of Object.entries(scenes)) el.hidden = k !== name; }
function hint(text) { $('hint').textContent = text; }
function say(text) { $('status').textContent = text; }
function setMode(mode) {
  cinema.classList.toggle('is-loading', mode === 'loading');
  cinema.classList.toggle('is-running', mode === 'loading' || mode === 'running');
}

async function play(id, fromEl) {
  const reel = content.reels.find(r => r.id === id);
  if (!reel) return;
  const my = ++run;
  closeTheatre();
  active = reel; index = 0;
  shelf.querySelectorAll('.reel').forEach(b => b.classList.toggle('on-projector', b.dataset.id === id));
  hint(`Threading ${reel.title.toLowerCase()}…`); say(`Loading ${reel.act}, ${reel.title}.`);
  if (fromEl) await flyToProjector(fromEl);
  if (my !== run) return;

  setMode('loading'); sound.start();
  show('leader');
  for (const n of [3, 2, 1]) { $('leader-num').textContent = n; await wait(800); if (my !== run) return; }

  $('tc-act').textContent = reel.act;
  $('tc-title').textContent = reel.title;
  $('tc-tagline').textContent = reel.tagline || '';
  $('tc-note').hidden = reel.items.length > 0;
  show('titlecard'); setMode('running'); sound.stop(1.5);
  hint(`Now showing: ${reel.title}`);
  if (!reel.items.length) { hint(`${reel.title} is coming soon. Try another reel.`); say(`${reel.title} has nothing on it yet.`); return; }
  await wait(2200); if (my !== run) return;

  show('player');
  $('player-reel').textContent = `${reel.act} · ${reel.title}`;
  showItem(0);
  say(`${reel.title} is playing. ${reel.items.length} pieces.`);
}

function eject() {
  run++; sound.stop(.2); closeTheatre();
  const was = active; active = null;
  scenes.player.querySelector('.slide-holder').replaceChildren();
  show('welcome'); setMode('idle');
  shelf.querySelectorAll('.reel').forEach(b => b.classList.remove('on-projector'));
  hint('Pick a reel. Drag it to the projector.');
  if (was) { say('Reel ejected.'); shelf.querySelector(`[data-id="${was.id}"]`)?.focus(); }
}

// ---------- player ----------
function embedUrl(url) {
  try {
    const u = new URL(url, location.href), h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}?rel=0`;
    if (h.endsWith('youtube.com')) {
      const id = u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    }
    if (h === 'vimeo.com') { const id = u.pathname.match(/\/(\d+)/)?.[1]; if (id) return `https://player.vimeo.com/video/${id}`; }
    if (h === 'soundcloud.com') return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&visual=true&color=%23f2b705`;
    if (h === 'open.spotify.com' && !u.pathname.startsWith('/embed')) return `https://open.spotify.com/embed${u.pathname}`;
    if (h === 'instagram.com') { const m = u.pathname.match(/\/(p|reel)\/([\w-]+)/); if (m) return `https://www.instagram.com/${m[1]}/${m[2]}/embed`; }
    return u.href;
  } catch { return url; }
}

function renderItem(item) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  const alt = item.caption || `${active.title} piece`;
  if (item.type === 'video') {
    const v = document.createElement('video');
    v.src = item.src; v.controls = true; v.playsInline = true; v.preload = 'metadata';
    if (item.poster) v.poster = item.poster;
    v.addEventListener('play', () => sound.stop(.2));
    slide.append(v);
  } else if (item.type === 'audio') {
    slide.classList.add('audio');
    const art = document.createElement('img'); art.src = reelArt(active.id); art.alt = '';
    const a = document.createElement('audio'); a.src = item.src; a.controls = true; a.preload = 'metadata';
    slide.append(art, a);
  } else if (item.type === 'embed') {
    const f = document.createElement('iframe');
    f.src = embedUrl(item.src); f.title = alt; f.loading = 'lazy';
    f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    f.allowFullscreen = true;
    slide.append(f);
  } else {
    const img = document.createElement('img'); img.src = item.src; img.alt = alt; img.decoding = 'async';
    slide.append(img);
  }
  return slide;
}

function showItem(i) {
  if (!active || !active.items.length) return;
  index = (i + active.items.length) % active.items.length;
  const item = active.items[index];
  const holder = $('slide-holder');
  holder.querySelectorAll('video, audio').forEach(m => m.pause());
  holder.replaceChildren(renderItem(item));
  $('caption').textContent = item.caption || '';
  $('player-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(active.items.length).padStart(2, '0')}`;
  const many = active.items.length > 1;
  $('btn-prev').disabled = !many; $('btn-next').disabled = !many;
  // preload the next image so paging feels instant
  const next = active.items[(index + 1) % active.items.length];
  if (next?.type === 'image') new Image().src = next.src;
  wake();
}

// Fade the player chrome away after a few idle seconds so the work gets the whole screen.
function wake() {
  scenes.player.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => scenes.player.classList.add('idle'), 3200);
}
['pointermove', 'pointerdown', 'focusin'].forEach(t => scenes.player.addEventListener(t, wake));

$('btn-prev').addEventListener('click', () => showItem(index - 1));
$('btn-next').addEventListener('click', () => showItem(index + 1));
$('btn-eject').addEventListener('click', eject);
$('btn-theatre').addEventListener('click', () => screen.classList.contains('theatre') ? closeTheatre() : openTheatre());
function openTheatre() {
  screen.classList.add('theatre'); document.body.classList.add('theatre-open');
  $('btn-theatre').querySelector('.chip-label').textContent = 'Close';
  $('btn-theatre').setAttribute('aria-label', 'Leave theatre mode');
}
function closeTheatre() {
  screen.classList.remove('theatre'); document.body.classList.remove('theatre-open');
  $('btn-theatre').querySelector('.chip-label').textContent = 'Theatre';
  $('btn-theatre').setAttribute('aria-label', 'Theatre mode');
}

// swipe between pieces on touch screens
let swipe = null;
$('slide-holder').addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') swipe = { x: e.clientX, y: e.clientY }; });
$('slide-holder').addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showItem(index + (dx < 0 ? 1 : -1));
});

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, iframe, dialog')) return;
  if (e.key === 'Escape') { if (drag) cancelDrag(); else if (screen.classList.contains('theatre')) closeTheatre(); else if (active) eject(); }
  if (!active || scenes.player.hidden) return;
  if (e.key === 'ArrowRight') showItem(index + 1);
  if (e.key === 'ArrowLeft') showItem(index - 1);
  if (e.key === 'f' || e.key === 'F') screen.classList.contains('theatre') ? closeTheatre() : openTheatre();
});

projector.addEventListener('click', () => {
  if (!active) {
    hint('Choose a reel first, then it goes on here.');
    say('Choose one of the reels below to load the projector.');
  }
});

// ---------- drag & drop ----------
function beginDrag(e, el, reel) {
  if (e.button !== 0 || drag) return;
  drag = { id: e.pointerId, el, reel, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
  el.setPointerCapture(e.pointerId);
}
function overProjector(x, y) {
  if (!projector.offsetParent) return false;
  const r = projector.getBoundingClientRect(), pad = r.width * .15;
  return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
}
function makeGhost(el) {
  const g = document.createElement('div'); g.className = 'drag-ghost'; g.setAttribute('aria-hidden', 'true');
  g.innerHTML = `<img src="${el.querySelector('img').src}" alt="">`;
  g.style.width = el.getBoundingClientRect().width + 'px';
  document.body.append(g);
  return g;
}
document.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) {
    drag.moved = true; drag.ghost = makeGhost(drag.el);
    drag.el.classList.add('in-hand'); cinema.classList.add('is-dragging');
    hint('Over to the projector…');
  }
  if (!drag.moved) return;
  drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
  const over = overProjector(e.clientX, e.clientY);
  projector.classList.toggle('over', over);
  if (over) hint('Let go to load it!');
});
document.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const { moved, reel, ghost } = drag, hit = moved && overProjector(e.clientX, e.clientY);
  drag.ghost = null; cancelDrag();
  if (!moved) return;
  suppressClick = true; setTimeout(() => suppressClick = false, 0);
  if (hit) { mountGhost(ghost).then(() => play(reel.id)); }
  else { ghost?.remove(); hint(active ? `Now showing: ${active.title}` : 'Pick a reel. Drag it to the projector.'); }
});
document.addEventListener('pointercancel', cancelDrag);
window.addEventListener('blur', cancelDrag);
function cancelDrag() {
  if (!drag) return;
  drag.ghost?.remove();
  drag.el.classList.remove('in-hand');
  if (drag.el.hasPointerCapture?.(drag.id)) drag.el.releasePointerCapture(drag.id);
  drag = null;
  cinema.classList.remove('is-dragging'); projector.classList.remove('over');
}

// The spindle on the projector's reel arm, as a fraction of the camera art.
function spindle() {
  const r = projector.getBoundingClientRect();
  return { x: r.left + r.width * .64, y: r.top + r.height * .23 };
}
function mountGhost(g) {
  if (!g) return Promise.resolve();
  if (reduced || !projector.offsetParent) { g.remove(); return Promise.resolve(); }
  const p = spindle();
  g.classList.add('flying');
  requestAnimationFrame(() => { g.style.left = p.x + 'px'; g.style.top = p.y + 'px'; g.style.scale = '.35'; g.style.rotate = '180deg'; g.style.opacity = '0'; });
  return new Promise(r => setTimeout(() => { g.remove(); r(); }, 560));
}
function flyToProjector(el) {
  if (reduced || !projector.offsetParent) return Promise.resolve();
  const r = el.getBoundingClientRect(), g = makeGhost(el);
  g.style.left = r.left + r.width / 2 + 'px'; g.style.top = r.top + r.height / 2 + 'px';
  return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => mountGhost(g).then(res))));
}

// ---------- projector sound: a soft 24fps clatter synthesised on the fly ----------
const sound = (() => {
  let ctx = null, node = null, gain = null;
  let on = true;
  try { on = localStorage.getItem('hp-sound') !== 'off'; } catch {}
  const btn = $('btn-sound');
  const render = () => { btn.setAttribute('aria-pressed', String(on)); $('sound-label').textContent = on ? 'Sound on' : 'Sound off'; };
  render();
  btn.addEventListener('click', () => {
    on = !on; render();
    try { localStorage.setItem('hp-sound', on ? 'on' : 'off'); } catch {}
    if (!on) api.stop(.1);
  });
  const api = {
    start() {
      if (!on || reduced) return;
      try {
        ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        ctx.resume();
        api.stop(0);
        const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
        const period = ctx.sampleRate / 24;
        for (let i = 0; i < len; i++) {
          const t = (i % period) / period;
          d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 28) * .9 + .06);
        }
        node = ctx.createBufferSource(); node.buffer = buf; node.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = .8;
        gain = ctx.createGain(); gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(.09, ctx.currentTime + .4);
        node.connect(f).connect(gain).connect(ctx.destination); node.start();
      } catch {}
    },
    stop(fade = .6) {
      if (!node || !ctx) return;
      const n = node, g = gain; node = null;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      setTimeout(() => { try { n.stop(); } catch {} }, fade * 1000 + 50);
    }
  };
  return api;
})();

// ---------- credits ----------
$('btn-credits').addEventListener('click', () => $('credits').showModal());
$('credits').addEventListener('click', e => { if (e.target === $('credits')) $('credits').close(); });

loadContent();
