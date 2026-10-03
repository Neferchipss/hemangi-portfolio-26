'use strict';
// Projection Booth: a no-backend admin for the portfolio.
// It reads/writes <folder>/content.json and <folder>/media/** in the GitHub repo through the
// GitHub REST API using a fine-grained token, and bundles everything into a single commit.
// Pushing to the branch triggers the Pages workflow, which redeploys the site.

const REELS = [
  { id: 'singing', act: 'Prequel', title: 'Singing' },
  { id: 'painting', act: 'Act 1', title: 'Painting' },
  { id: 'craft', act: 'Act 2', title: 'Art, Craft & Clay' },
  { id: 'fashion', act: 'Sequel', title: 'Fashion' },
  { id: 'brewing', act: 'The Spin-off', title: 'Brewing' }
];
const DEFAULT_REPO = 'Neferchipss/hemangi-portfolio-26';
const MAX_FILE = 95 * 1024 * 1024;   // GitHub rejects files over 100 MB
const WARN_FILE = 40 * 1024 * 1024;
const VIDEO_TARGET = 45 * 1024 * 1024;   // videos bigger than this are re-encoded in the browser to about this size
const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.61.0/+esm';
const IMG_MAX_SIDE = 2400;

const $ = id => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
};

let cfg = null;               // { repo, branch, folder, token }
let remote = null;            // { head, contentSha, json }
let draft = null;
const pending = new Map();    // src -> { blob, url }  (files not yet in the repo)
const justPublished = new Map(); // src -> url  (in the repo, but the site may still be rebuilding)
let tab = 'site';
let busy = false;

// ---------- storage ----------
function loadCfg() {
  for (const store of [sessionStorage, localStorage]) {
    try { const c = JSON.parse(store.getItem('hp-booth') || 'null'); if (c?.token) return c; } catch {}
  }
  return null;
}
function saveCfg(c, remember) {
  try {
    localStorage.removeItem('hp-booth'); sessionStorage.removeItem('hp-booth');
    (remember ? localStorage : sessionStorage).setItem('hp-booth', JSON.stringify(c));
  } catch {}
}
function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg && seg !== 'admin' ? `${m[1]}/${seg}` : DEFAULT_REPO;
}

// ---------- GitHub ----------
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}
const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64Utf8 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
const blobToB64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const contentPath = () => `${cfg.folder}/content.json`;

async function loadRemote() {
  const ref = await gh(`/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  let json, contentSha = null;
  try {
    const file = await gh(`/contents/${contentPath()}?ref=${ref.object.sha}`);
    json = JSON.parse(fromB64Utf8(file.content));
    contentSha = file.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
    json = { site: {}, reels: [] };
  }
  remote = { head: ref.object.sha, contentSha, json: normalise(json) };
  draft = structuredClone(remote.json);
}
function normalise(c) {
  const byId = Object.fromEntries((c.reels || []).map(r => [r.id, r]));
  return {
    site: { name: 'Hemangi', tagline: '', about: '', email: '', links: [], ...(c.site || {}) },
    reels: REELS.map(base => ({ ...base, tagline: '', ...(byId[base.id] || {}), items: [...(byId[base.id]?.items || [])] }))
  };
}

// ---------- connect ----------
function showConnect(error) {
  $('workspace').hidden = true; $('connect').hidden = false;
  ['btn-publish', 'btn-preview'].forEach(id => $(id).hidden = true);
  $('f-repo').value = cfg?.repo || guessRepo();
  $('f-branch').value = cfg?.branch || 'main';
  $('f-folder').value = cfg?.folder || 'dist';
  $('connect-error').hidden = !error; $('connect-error').textContent = error || '';
}
$('connect-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; btn.textContent = 'Connecting…';
  cfg = { repo: $('f-repo').value.trim(), branch: $('f-branch').value.trim(), folder: $('f-folder').value.trim().replace(/^\/|\/$/g, ''), token: $('f-token').value.trim() };
  try {
    await start();
    saveCfg(cfg, $('f-remember').checked);
    $('f-token').value = '';
  } catch (err) {
    showConnect(err.message);
  } finally { btn.disabled = false; btn.textContent = 'Connect'; }
});
async function start() {
  const repo = await gh('');
  if (!repo.permissions?.push) throw new Error('This token can read the repository but cannot write to it. Give it Contents: Read and write.');
  await loadRemote();
  $('connect').hidden = true; $('workspace').hidden = false;
  ['btn-publish', 'btn-preview'].forEach(id => $(id).hidden = false);
  renderTabs(); renderEditor(); markDirty();
}

// ---------- dirty tracking ----------
function isDirty() { return JSON.stringify(draft) !== JSON.stringify(remote.json); }
function markDirty() {
  const dirty = isDirty();
  $('status').textContent = dirty ? 'Unpublished changes' : 'All changes are live';
  $('status').classList.toggle('dirty', dirty);
  $('btn-publish').disabled = !dirty || busy;
  schedulePreview();
}
window.addEventListener('beforeunload', e => { if (draft && remote && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---------- tabs ----------
function renderTabs() {
  const nav = $('tabs'); nav.replaceChildren();
  nav.append(h('button', { class: 'tab site', type: 'button', 'aria-current': String(tab === 'site'), onclick: () => go('site') }, '✦ Site & credits'));
  draft.reels.forEach(r => nav.append(
    h('button', { class: 'tab', type: 'button', 'aria-current': String(tab === r.id), onclick: () => go(r.id) },
      h('img', { src: `../assets/reel-${r.id}.webp`, alt: '' }),
      h('span', {}, h('span', { class: 't-act' }, r.act), h('span', { class: 't-title' }, r.title), h('span', { class: 't-count' }, `${r.items.length} piece${r.items.length === 1 ? '' : 's'}`)))
  ));
}
function go(id) { tab = id; renderTabs(); renderEditor(); $('editor').scrollTop = 0; window.scrollTo({ top: 0 }); }

function field(label, value, oninput, { multiline = false, cls = '', placeholder = '', type = 'text' } = {}) {
  const input = multiline ? h('textarea', { placeholder }) : h('input', { type, placeholder });
  input.value = value || '';
  input.addEventListener('input', () => { oninput(input.value); markDirty(); });
  return h('label', { class: cls }, label, input);
}

// ---------- editor ----------
function renderEditor() {
  const ed = $('editor'); ed.replaceChildren();
  if (tab === 'site') return renderSite(ed);
  const reel = draft.reels.find(r => r.id === tab);
  ed.append(
    h('h2', {}, `${reel.act} · ${reel.title}`),
    h('p', { class: 'lede' }, 'This is what plays on the cinema screen when someone loads this reel. Drag the cards to change the order.'),
    h('div', { class: 'fields' },
      field('Act label', reel.act, v => { reel.act = v; renderTabs(); }, { placeholder: 'Prequel' }),
      field('Title', reel.title, v => { reel.title = v; renderTabs(); }, { placeholder: 'Singing' }),
      field('Tagline on the title card', reel.tagline, v => reel.tagline = v, { cls: 'full', placeholder: 'For the things words alone can’t say.' })
    ),
    dropZone(reel),
    h('div', { class: 'section-head' }, h('h3', {}, `On the screen (${reel.items.length})`)),
    reel.items.length ? itemsGrid(reel) : h('p', { class: 'empty' }, 'Nothing on this reel yet. Visitors will see a “coming soon” title card.')
  );
}

function renderSite(ed) {
  const s = draft.site;
  const links = h('div', { class: 'links-list' });
  const drawLinks = () => {
    links.replaceChildren(...s.links.map((l, i) => h('div', { class: 'link-row' },
      field('Label', l.label, v => l.label = v, { placeholder: 'Instagram' }),
      field('URL', l.url, v => l.url = v, { placeholder: 'https://instagram.com/…', type: 'url' }),
      h('button', { class: 'btn danger small', type: 'button', style: 'align-self:end', onclick: () => { s.links.splice(i, 1); drawLinks(); markDirty(); } }, 'Remove')
    )));
  };
  drawLinks();
  ed.append(
    h('h2', {}, 'Site & credits'),
    h('p', { class: 'lede' }, 'Edit the “Credits” card with a little about-me and contact links.'),
    h('div', { class: 'fields' },
      field('Name', s.name, v => s.name = v),
      field('About (shown in the credits)', s.about, v => s.about = v, { multiline: true, cls: 'full' }),
      field('Email', s.email, v => s.email = v, { type: 'email', cls: 'full', placeholder: 'hello@example.com' })
    ),
    h('div', { class: 'section-head' }, h('h3', {}, 'Links'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { s.links.push({ label: '', url: '' }); drawLinks(); markDirty(); } }, '+ Add link')),
    links
  );
}

// ---------- adding media ----------
function dropZone(reel) {
  const picker = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*,audio/*', hidden: true });
  picker.addEventListener('change', () => { addFiles(reel, [...picker.files]); picker.value = ''; });
  const zone = h('div', { class: 'drop' },
    h('div', {}, h('strong', {}, 'Drop photos, videos or audio here'), h('br'), h('small', {}, 'Big photos are resized and big videos are compressed automatically. For videos longer than about 12 minutes, use a YouTube or Vimeo link.')),
    h('div', { class: 'drop-actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => picker.click() }, 'Choose files'),
      h('button', { class: 'btn', type: 'button', onclick: () => addLink(reel) }, 'Add a link')),
    picker
  );
  zone.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); zone.classList.add('over'); } });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); addFiles(reel, [...e.dataTransfer.files]); });
  return zone;
}

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'piece';
const rand = () => Math.random().toString(36).slice(2, 6);
function kindOf(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, ext: file.name.split('.').pop().toLowerCase() };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, IMG_MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900 * 1024) return { blob: file, ext: file.name.split('.').pop().toLowerCase() };
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/webp', .86));
    if (blob && blob.size < file.size) return { blob, ext: 'webp' };
  } catch {}
  return { blob: file, ext: file.name.split('.').pop().toLowerCase() };
}

// Re-encodes a big video to H.264 MP4 at a bitrate that lands near VIDEO_TARGET, using the
// browser's own (usually hardware) encoder through Mediabunny. Throws with a message for the user.
async function compressVideo(file, onProgress) {
  const mb = await import(MEDIABUNNY).catch(() => { throw new Error('the video tools couldn’t load. Check the connection and try again'); });
  if (!(await mb.canEncodeVideo('avc'))) throw new Error('this browser can’t re-encode video. Try Chrome or Edge');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('it has no video track this browser can read');
  const duration = await input.computeDuration();
  const audioBits = (await input.getPrimaryAudioTrack()) ? 160e3 : 0;
  // 8% headroom for container overhead and encoder overshoot. Aim for VIDEO_TARGET, but let long
  // videos grow toward 90 MB rather than drop below a watchable 1.5 Mbps.
  const bitsFor = bytes => bytes * 8 * .92 / duration - audioBits;
  let videoBits = Math.min(8e6, bitsFor(VIDEO_TARGET));
  if (videoBits < 1.5e6) videoBits = Math.min(1.5e6, bitsFor(90 * 1024 * 1024));
  if (videoBits < 700e3) throw new Error(`it’s too long (${Math.round(duration / 60)} min) to fit without looking bad. Upload it to YouTube or Vimeo and add the link instead`);
  // keep the short side at 1080p, or 720p when the bitrate is tight
  const w = await track.getDisplayWidth(), hgt = await track.getDisplayHeight();
  const short = Math.min(w, hgt), cap = videoBits < 2.5e6 ? 720 : 1080;
  const video = { codec: 'avc', quality: new mb.Quality({ bitrate: Math.round(videoBits) }), forceTranscode: true };
  if (short > cap) video.width = Math.round(w * cap / short / 2) * 2;
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const conversion = await mb.Conversion.init({ input, output, video });
  if (!conversion.isValid || conversion.discardedTracks.some(t => t.track.type === 'audio')) throw new Error('this browser can’t convert its video or sound. Try Chrome or Edge');
  conversion.onProgress = onProgress;
  await conversion.execute();
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  if (blob.size > MAX_FILE) throw new Error('it’s still over 95 MB after compressing. Upload it to YouTube or Vimeo and add the link instead');
  return blob;
}

async function addFiles(reel, files) {
  let added = 0;
  for (const file of files) {
    const type = kindOf(file);
    if (!type) { toast(`“${file.name}” isn’t a photo, video or audio file, so it was skipped.`, true); continue; }
    let blob = file, ext = file.name.split('.').pop().toLowerCase();
    if (type === 'video' && file.size > VIDEO_TARGET) {
      const bar = h('span');
      const show = frac => { toast(h('span', {}, `Compressing “${file.name}” (${Math.round(file.size / 1048576)} MB)… keep this tab open. ${Math.round(frac * 100)}%`, h('div', { class: 'progress' }, bar)), false, 0); bar.style.width = `${Math.round(frac * 100)}%`; };
      busy = true; markDirty(); show(0);
      try {
        blob = await compressVideo(file, show); ext = 'mp4';
        toast(`“${file.name}” compressed from ${Math.round(file.size / 1048576)} MB to ${Math.round(blob.size / 1048576)} MB.`);
      } catch (e) {
        toast(`Couldn’t add “${file.name}”: ${e.message}.`, true, 12000); continue;
      } finally { busy = false; markDirty(); }
    } else if (file.size > MAX_FILE) { toast(`“${file.name}” is over 95 MB, which GitHub won’t accept. Upload it to YouTube, Vimeo or SoundCloud and add the link instead.`, true); continue; }
    else if (file.size > WARN_FILE) toast(`“${file.name}” is quite big (${Math.round(file.size / 1048576)} MB). It will work, but it will load slowly for visitors.`);
    if (type === 'image') ({ blob, ext } = await shrinkImage(file));
    const src = `media/${reel.id}/${slug(file.name.replace(/\.[^.]+$/, ''))}-${rand()}.${ext}`;
    pending.set(src, { blob, url: URL.createObjectURL(blob) });
    reel.items.push({ type, src, caption: '' });
    added++;
  }
  if (added) { renderEditor(); renderTabs(); markDirty(); }
}

function linkKind(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com|spotify\.com|instagram\.com)$/.test(host)) return 'embed';
  const ext = u.pathname.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(ext)) return 'audio';
  return 'embed';
}
function addLink(reel) {
  const dlg = $('link-dialog'), form = $('link-form');
  form.reset();
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const url = $('link-url').value.trim(), type = linkKind(url);
    if (!type) return toast('That doesn’t look like a web link.', true);
    reel.items.push({ type, src: url, caption: $('link-caption').value.trim() });
    renderEditor(); renderTabs(); markDirty();
  };
  dlg.showModal();
}

// ---------- items ----------
function youtubeId(url) {
  try {
    const u = new URL(url), host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1);
    if (host.endsWith('youtube.com')) return u.searchParams.get('v') || u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];
  } catch {}
  return null;
}
const isRemote = src => /^https?:/i.test(src);
const adminSrc = src => pending.get(src)?.url || justPublished.get(src) || (isRemote(src) ? src : `../${src}`);

function thumbFor(item) {
  const src = adminSrc(item.src);
  if (item.type === 'image') return h('img', { src, alt: '', loading: 'lazy' });
  if (item.type === 'video') return h('video', { src: src + '#t=0.5', muted: true, preload: 'metadata', playsinline: true });
  if (item.type === 'audio') return h('div', {}, h('div', { class: 'glyph' }, '♫'));
  const yt = youtubeId(item.src);
  if (yt) return h('img', { src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, alt: '', loading: 'lazy' });
  return h('div', {}, h('div', { class: 'glyph' }, '▶'), h('div', { class: 'url' }, item.src));
}

let dragFrom = null;
function itemsGrid(reel) {
  const grid = h('div', { class: 'items' });
  reel.items.forEach((item, i) => {
    const move = to => { const [it] = reel.items.splice(i, 1); reel.items.splice(to, 0, it); renderEditor(); markDirty(); };
    const caption = h('input', { placeholder: 'Caption (optional)', maxlength: '200' });
    caption.value = item.caption || '';
    caption.addEventListener('input', () => { item.caption = caption.value; markDirty(); });
    const card = h('div', { class: 'item' },
      h('div', { class: 'thumb', draggable: 'true', title: 'Drag to reorder' },
        thumbFor(item),
        h('span', { class: 'badge' }, item.type === 'embed' ? 'link' : item.type),
        pending.has(item.src) ? h('span', { class: 'badge new' }, 'new') : null,
        h('span', { class: 'num' }, String(i + 1).padStart(2, '0'))),
      h('div', { class: 'item-body' },
        caption,
        h('div', { class: 'item-tools' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move earlier', disabled: i === 0, onclick: () => move(i - 1) }, '←'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move later', disabled: i === reel.items.length - 1, onclick: () => move(i + 1) }, '→'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn danger small', type: 'button', onclick: () => {
            reel.items.splice(i, 1);
            const p = pending.get(item.src); if (p) { URL.revokeObjectURL(p.url); pending.delete(item.src); }
            renderEditor(); renderTabs(); markDirty();
          } }, 'Remove')))
    );
    const thumb = card.firstChild;
    thumb.addEventListener('dragstart', e => { dragFrom = i; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    thumb.addEventListener('dragend', () => { dragFrom = null; card.classList.remove('dragging'); });
    card.addEventListener('dragover', e => { if (dragFrom === null) return; e.preventDefault(); card.classList.add('drop-before'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before'));
    card.addEventListener('drop', e => {
      if (dragFrom === null) return;
      e.preventDefault(); card.classList.remove('drop-before');
      const from = dragFrom; dragFrom = null;
      if (from === i) return;
      const [it] = reel.items.splice(from, 1);
      reel.items.splice(from < i ? i - 1 : i, 0, it);
      renderEditor(); markDirty();
    });
    grid.append(card);
  });
  return grid;
}

// ---------- preview ----------
let previewTimer = 0;
function previewContent() {
  const c = structuredClone(draft);
  c.reels.forEach(r => r.items.forEach(it => { const local = pending.get(it.src)?.url || justPublished.get(it.src); if (local) it.src = local; }));
  return c;
}
function sendPreview() {
  const frame = $('preview-frame');
  if ($('preview-pane').hidden || !frame.contentWindow) return;
  frame.contentWindow.postMessage({ type: 'hp-preview', content: previewContent() }, location.origin);
}
function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(sendPreview, 300); }
window.addEventListener('message', e => { if (e.origin === location.origin && e.data?.type === 'hp-preview-ready') sendPreview(); });
$('btn-preview').addEventListener('click', () => {
  const pane = $('preview-pane');
  if (!pane.hidden) return closePreview();
  pane.hidden = false; $('workspace').classList.add('with-preview');
  $('preview-frame').src = '../?preview=1';
  $('btn-preview').textContent = 'Hide preview';
});
$('btn-preview-close').addEventListener('click', closePreview);
function closePreview() {
  $('preview-pane').hidden = true; $('workspace').classList.remove('with-preview');
  $('preview-frame').src = 'about:blank'; $('btn-preview').textContent = 'Preview';
}

// ---------- publish ----------
const mediaPaths = c => new Set(c.reels.flatMap(r => r.items.map(i => i.src)).filter(s => s.startsWith('media/')));

$('btn-publish').addEventListener('click', publish);
async function publish() {
  if (busy) return;
  busy = true; markDirty();
  const bar = h('span');
  const step = (text, frac) => { toast(h('span', {}, text, h('div', { class: 'progress' }, bar)), false, 0); bar.style.width = `${Math.round(frac * 100)}%`; };
  try {
    step('Checking the repository…', .05);
    const ref = await gh(`/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    const head = ref.object.sha;
    if (head !== remote.head) {
      // Someone else committed meanwhile. Fine, unless they touched content.json too.
      let sha = null;
      try { sha = (await gh(`/contents/${contentPath()}?ref=${head}`)).sha; } catch (e) { if (e.status !== 404) throw e; }
      if (sha !== remote.contentSha) throw new Error('The content was changed from somewhere else since this page was opened. Copy any captions you need, then reload the page to get the latest version.');
    }
    const commit = await gh(`/git/commits/${head}`);
    const tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
    const existing = new Set(tree.tree.map(t => t.path));

    const used = mediaPaths(draft);
    const uploads = [...pending.keys()].filter(src => used.has(src));
    const entries = [];
    for (const [n, src] of uploads.entries()) {
      step(`Uploading ${n + 1} of ${uploads.length}…`, .1 + .75 * (n / Math.max(1, uploads.length)));
      const blob = await gh('/git/blobs', { method: 'POST', body: { content: await blobToB64(pending.get(src).blob), encoding: 'base64' } });
      entries.push({ path: `${cfg.folder}/${src}`, mode: '100644', type: 'blob', sha: blob.sha });
    }
    // Remove media that no reel uses any more.
    for (const src of mediaPaths(remote.json)) {
      const path = `${cfg.folder}/${src}`;
      if (!used.has(src) && existing.has(path)) entries.push({ path, mode: '100644', type: 'blob', sha: null });
    }
    entries.push({ path: contentPath(), mode: '100644', type: 'blob', content: JSON.stringify(draft, null, 2) + '\n' });

    step('Saving…', .9);
    const newTree = await gh('/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: entries } });
    const summary = summarise(uploads.length);
    const newCommit = await gh('/git/commits', { method: 'POST', body: { message: `Update portfolio content: ${summary}\n\nPublished from the Projection Booth admin.`, tree: newTree.sha, parents: [head] } });
    await gh(`/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: { sha: newCommit.sha } });

    // Uploaded files are now part of the site.
    // Keep showing local copies until the rebuilt site has them.
    for (const src of uploads) { justPublished.set(src, pending.get(src).url); pending.delete(src); }
    for (const src of [...pending.keys()]) { URL.revokeObjectURL(pending.get(src).url); pending.delete(src); }
    const file = await gh(`/contents/${contentPath()}?ref=${newCommit.sha}`);
    remote = { head: newCommit.sha, contentSha: file.sha, json: structuredClone(draft) };
    busy = false; markDirty(); renderEditor();
    watchDeploy(newCommit.sha);
  } catch (err) {
    busy = false; markDirty();
    if (err.status === 401) { toast('Your access token was rejected. It may have expired, so please connect again.', true); showConnect('Token rejected. Paste a fresh token.'); return; }
    toast(`Couldn’t publish: ${err.message}`, true, 12000);
  }
}
function summarise(uploadCount) {
  const changed = draft.reels.filter((r, i) => JSON.stringify(r) !== JSON.stringify(remote.json.reels[i])).map(r => r.title.toLowerCase());
  const bits = [];
  if (JSON.stringify(draft.site) !== JSON.stringify(remote.json.site)) bits.push('site details');
  if (changed.length) bits.push(changed.join(', '));
  if (uploadCount) bits.push(`${uploadCount} new file${uploadCount === 1 ? '' : 's'}`);
  return bits.join('; ') || 'edits';
}

async function watchDeploy(sha) {
  toast('Published! The site is rebuilding. This usually takes about a minute.', false, 0);
  const started = Date.now();
  while (Date.now() - started < 4 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 8000));
    let runs;
    try { runs = await gh(`/actions/runs?head_sha=${sha}&per_page=5`); }
    catch { toast('Published! Give it a minute or two, then refresh the site to see the changes.', false, 10000); return; }
    const run = runs.workflow_runs?.[0];
    if (!run) continue;
    if (run.status === 'completed') {
      if (run.conclusion === 'success') toast(h('span', {}, 'You’re live! ', h('a', { href: '../', target: '_blank', rel: 'noopener' }, 'Open the site ↗')), false, 15000);
      else toast(h('span', {}, 'Saved, but the site build failed. ', h('a', { href: run.html_url, target: '_blank', rel: 'noopener' }, 'See what happened ↗')), true, 0);
      return;
    }
  }
  toast('Published! The rebuild is taking a little longer than usual; refresh the site in a few minutes.', false, 10000);
}

// ---------- toast ----------
let toastTimer = 0;
function toast(msg, error = false, ms = 6000) {
  const t = $('toast');
  t.replaceChildren(typeof msg === 'string' ? document.createTextNode(msg) : msg);
  t.classList.toggle('error', error); t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.hidden = true, ms);
}

// ---------- boot ----------
(async () => {
  cfg = loadCfg();
  if (!cfg) return showConnect();
  try { await start(); }
  catch (err) { showConnect(err.status === 401 ? 'Your saved token was rejected. It may have expired.' : err.message); }
})();
