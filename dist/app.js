'use strict';
// Replace a category's video value with an MP4/WebM URL when the real films are ready.
const REELS = [
  {id:'painting',title:'Painting',caption:'This',crop:[68,674,271,210],colors:['#293c35','#a94a31','#c29b57'],lines:['A little colour. A lot of feeling.','Sometimes, the brush says it better.','A world of my own, one stroke at a time.'],video:null},
  {id:'singing',title:'Singing',caption:'That',crop:[351,697,262,209],colors:['#29232f','#9f4e39','#bba074'],lines:['For the things words alone can’t say.','Finding a little of myself in every note.','Some feelings come with a melody.'],video:null},
  {id:'fashion',title:'Fashion',caption:'The Other Thing',crop:[631,702,269,212],colors:['#302c24','#787755','#ae6846'],lines:['A different kind of self-portrait.','Texture. Shape. A little personality.','Getting dressed, telling stories.'],video:null},
  {id:'craft',title:'Art, craft & clay',caption:'Some Other Thing',crop:[908,704,277,209],colors:['#4c2923','#b06542','#b8996e'],lines:['Made slowly. Made by hand.','A little messy. A little magic.','Something from almost nothing.'],video:null},
  {id:'brewing',title:'Brewing',caption:'One More Thing',crop:[1192,699,272,215],colors:['#252f28','#677158','#b79862'],lines:['Good things take their own sweet time.','A little ritual. A little curiosity.','Let’s see what’s brewing.'],video:null}
];
const $ = id => document.getElementById(id);
const cinema=$('cinema'), film=$('film'), welcome=$('welcome'), countdown=$('countdown'), projector=$('projector');
let active=null, pending=null, playing=false, elapsed=0, loadVersion=0, last=0, drag=null, suppressClick=false, actualVideo=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
REELS.forEach((reel,i)=>{
  const button=document.createElement('button');button.className='reel';button.dataset.id=reel.id;
  button.setAttribute('aria-label',`${reel.title}: drag to the projector or click to play`);button.setAttribute('aria-pressed','false');
  const [x,y,w,h]=reel.crop;
  button.innerHTML=`<span class="reel-picture"><svg viewBox="${x} ${y} ${w} ${h}" aria-hidden="true"><image href="assets/reference.jpeg" width="1536" height="1024"/></svg></span><span class="reel-badge">NOW PLAYING</span>`;
  button.addEventListener('click',()=>{if(!suppressClick)loadReel(reel.id)});
  button.addEventListener('pointerdown',e=>beginDrag(e,button,reel));
  $('reels').append(button);
});
const announce=text=>{$('live-status').textContent=text;};
function setInstruction(main,sub){$('instruction').textContent=main;$('secondary').textContent=sub;}
function clearVideo(){if(actualVideo){actualVideo.pause();actualVideo.remove();actualVideo=null;}}
function reset(){loadVersion++;clearVideo();active=null;pending=null;playing=false;elapsed=0;film.hidden=true;countdown.hidden=true;welcome.hidden=false;cinema.classList.remove('playing','loading','paused');projector.setAttribute('aria-label','Projector. Choose a reel to play.');document.querySelectorAll('.reel').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false')});setInstruction('Pick up a reel. Drag it to the projector.','or simply click one to play');announce('Reel ejected. Choose another film.');}
async function loadReel(id){
  const reel=REELS.find(r=>r.id===id);if(!reel)throw new Error('Unknown reel');
  const version=++loadVersion;clearVideo();active=reel;pending=reel;playing=false;elapsed=0;welcome.hidden=true;film.hidden=true;countdown.hidden=false;
  cinema.classList.remove('playing','paused');cinema.classList.add('loading');
  document.querySelectorAll('.reel').forEach(b=>{const selected=b.dataset.id===id;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
  setInstruction(`Threading ${reel.title.toLowerCase()}…`,'settle into your seat');announce(`Loading ${reel.title}.`);
  for(const n of [3,2,1]){$('count-number').textContent=n;await new Promise(r=>setTimeout(r,reduced?90:550));if(version!==loadVersion)return;}
  countdown.hidden=true;film.hidden=false;cinema.classList.remove('loading');cinema.classList.add('playing');pending=null;
  $('film-number').textContent=`REEL 0${REELS.indexOf(reel)+1} / 05`;$('film-title').textContent=reel.title;$('film-line').textContent=reel.lines[0];
  $('pause').textContent='Ⅱ';$('pause').setAttribute('aria-label','Pause preview');$('seek').value=0;$('time').textContent='0:00';
  if(reel.video){actualVideo=document.createElement('video');actualVideo.src=reel.video;actualVideo.playsInline=true;actualVideo.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:2;background:#16140e';film.insertBefore(actualVideo,film.firstChild);actualVideo.addEventListener('error',()=>{clearVideo();announce('This video could not be loaded. Showing the category preview instead.')});actualVideo.addEventListener('ended',()=>setPlaying(false));actualVideo.play().catch(()=>setPlaying(false));}
  playing=true;setInstruction(`Now showing: ${reel.title}`,'pick another reel whenever curiosity strikes');projector.setAttribute('aria-label',`${reel.title} loaded. Drop another reel to switch films.`);announce(`${reel.title} is now playing.`);
}
function setPlaying(value){if(!active||pending)return;playing=value;cinema.classList.toggle('paused',!playing);$('pause').textContent=playing?'Ⅱ':'▶';$('pause').setAttribute('aria-label',playing?'Pause preview':'Play preview');if(actualVideo){if(playing)actualVideo.play().catch(()=>setPlaying(false));else actualVideo.pause();}}
$('pause').addEventListener('click',()=>{if(elapsed>=24)elapsed=0;setPlaying(!playing)});
$('eject').addEventListener('click',()=>{reset();$('reels').firstElementChild.focus()});$('home').addEventListener('click',reset);
$('seek').addEventListener('input',e=>{elapsed=Number(e.target.value);if(actualVideo&&Number.isFinite(actualVideo.duration))actualVideo.currentTime=elapsed/24*actualVideo.duration;updateFrame();});
projector.addEventListener('click',()=>{if(active&&!pending)setPlaying(!playing);else{$('reels').firstElementChild.focus();announce('Choose any of the five reels to start.')}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){cancelDrag();reset();}if(e.code==='Space'&&active&&!pending&&e.target===document.body){e.preventDefault();setPlaying(!playing)}});
function beginDrag(e,button,reel){if(e.button!==0||drag)return;drag={id:e.pointerId,button,reel,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,moved:false,ghost:null};button.setPointerCapture(e.pointerId);}
function inProjector(x,y){const r=projector.getBoundingClientRect();return x>=r.left-12&&x<=r.right+12&&y>=r.top-12&&y<=r.bottom+12;}
document.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;drag.x=e.clientX;drag.y=e.clientY;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>7){drag.moved=true;drag.ghost=drag.button.cloneNode(true);drag.ghost.className='reel drag-ghost';drag.ghost.removeAttribute('aria-pressed');drag.ghost.setAttribute('aria-hidden','true');drag.ghost.tabIndex=-1;drag.ghost.style.width=`${drag.button.getBoundingClientRect().width}px`;document.body.append(drag.ghost);drag.button.classList.add('in-hand');cinema.classList.add('dragging');setInstruction('Over here. Drop it on the projector.','release anywhere else to put it back');}if(drag.moved){drag.ghost.style.left=`${e.clientX}px`;drag.ghost.style.top=`${e.clientY}px`;projector.classList.toggle('over',inProjector(e.clientX,e.clientY));}});
function cancelDrag(){if(!drag)return;drag.ghost?.remove();drag.button.classList.remove('in-hand');if(drag.button.hasPointerCapture(drag.id))drag.button.releasePointerCapture(drag.id);drag=null;cinema.classList.remove('dragging');projector.classList.remove('over');if(active)setInstruction(`Now showing: ${active.title}`,'pick another reel whenever curiosity strikes');else setInstruction('Pick up a reel. Drag it to the projector.','or simply click one to play');}
document.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const moved=drag.moved,id=drag.reel.id,accepted=moved&&inProjector(e.clientX,e.clientY);cancelDrag();if(moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);if(accepted)loadReel(id);else announce('Reel returned to the shelf.')}});
document.addEventListener('pointercancel',cancelDrag);window.addEventListener('blur',cancelDrag);
const canvas=$('art'),ctx=canvas.getContext('2d');
function drawArt(t){if(!active)return;const w=canvas.width,h=canvas.height;ctx.fillStyle=active.colors[0];ctx.fillRect(0,0,w,h);const type=REELS.indexOf(active);ctx.globalAlpha=.5;
  if(type===1){for(let j=0;j<4;j++){ctx.beginPath();ctx.strokeStyle=active.colors[(j%2)+1];ctx.lineWidth=3+j*3;for(let x=0;x<w;x+=4){const y=h*.5+Math.sin(x*.012+t*1.3+j)*Math.sin(x/w*Math.PI)*h*(.16+j*.05);if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();}}
  else if(type===2){for(let j=0;j<9;j++){ctx.save();ctx.translate(w*.5,h*.5);ctx.rotate(-.4+Math.sin(t*.2)*.12);ctx.fillStyle=active.colors[j%3];ctx.fillRect((j-4)*w*.19+Math.sin(t*.35)*50,-h,w*.115,h*3);ctx.restore();}}
  else{for(let j=0;j<12;j++){const x=(Math.sin(j*2.3+t*.13)*.55+.5)*w,y=(Math.cos(j*1.7+t*.18)*.5+.5)*h,r=(type===4?.08:.2)*w;const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,active.colors[1+j%2]);g.addColorStop(1,active.colors[0]+'00');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,r,r*(type===3?.5:1),t*.1,0,Math.PI*2);ctx.fill();}}
  ctx.globalAlpha=1;const shade=ctx.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#00000020');shade.addColorStop(.5,'#00000000');shade.addColorStop(1,'#00000090');ctx.fillStyle=shade;ctx.fillRect(0,0,w,h);
}
function updateFrame(){if(!active)return;$('seek').value=elapsed;$('time').textContent=`0:${String(Math.floor(elapsed)).padStart(2,'0')}`;$('film-line').textContent=active.lines[Math.min(2,Math.floor(elapsed/8))];drawArt(reduced?0:elapsed);}
new ResizeObserver(()=>{const r=film.getBoundingClientRect();canvas.width=Math.max(600,r.width);canvas.height=Math.max(320,r.height);updateFrame()}).observe($('screen'));
function tick(now){const dt=Math.min((now-last)/1000,.1);last=now;if(playing&&active&&!document.hidden){elapsed=actualVideo&&Number.isFinite(actualVideo.duration)?actualVideo.currentTime/actualVideo.duration*24:Math.min(24,elapsed+dt);if(elapsed>=24){setPlaying(false);setInstruction('That’s a wrap. What else shall we watch?','replay this film, or pick another reel');}updateFrame();}requestAnimationFrame(tick);}requestAnimationFrame(tick);
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'play_creative_reel',description:'Load and play one of Hemangi’s five category reels in the cinema.',inputSchema:{type:'object',properties:{category:{type:'string',enum:REELS.map(r=>r.id)}},required:['category'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{if(!input||!REELS.some(r=>r.id===input.category))throw new Error('Choose a valid category');await loadReel(input.category);return {category:active.id,playing};}})).catch(()=>{});}catch{}}
