/* ============================================================
   SD Little League Home Run Derby — game.js  v3
   Batter's-eye-view | 16-bit pixel art | right-handed batter #3
   Canvas: 320×480 logical (CSS-scaled, image-rendering:pixelated)
   ============================================================ */

'use strict';

// ─── Canvas resolution ────────────────────────────────────────
const LW = 320;
const LH = 480;

// ─── Field geometry (all in logical pixels) ──────────────────
// Vanishing point ≈ deep center field
const VP = { x: 160, y: 122 };

const F = {
  // Outfield structures
  wallY:   128,   // top of outfield wall
  wallBot: 144,   // bottom of outfield wall
  trackY:  144,   // warning track start (clay strip)
  trackBot:162,   // warning track end / grass begins
  // Foul poles (top of each pole)
  lPoleTop: { x: 14, y: 38 }, lPoleBase: { x: 14, y: 128 },
  rPoleTop: { x: 306,y: 38 }, rPoleBase: { x: 306,y: 128 },
  // Where foul lines reach the outfield wall
  lWallX: 14,  rWallX: 306,
  // Bases (in perspective 2D coords)
  b1: { x: 228, y: 312 },
  b2: { x: 160, y: 186 },
  b3: { x:  92, y: 312 },
  // Pitcher's mound
  mnd: { x: 160, y: 224 },
  // Home plate
  plt: { x: 160, y: 448 },
};

// Ball travels from pitcher release → hitting zone
const BALL_START  = { x: 163, y: 205 };   // pitcher release point
const BALL_END    = { x: 160, y: 388 };   // arrival (in front of plate)
const BALL_SIZE_S = 3;                     // small (far)
const BALL_SIZE_L = 22;                    // large (close)

// ─── Game constants ───────────────────────────────────────────
const TOTAL_PITCHES  = 10;
const PITCH_DURATION = 2300;

// Timing zones (fraction of pitchT; meter indicator = pitchT)
const PERFECT_MIN = 0.54;
const PERFECT_MAX = 0.74;
const GOOD_MIN    = 0.38;
const GOOD_MAX    = 0.92;

const SCORES = { hr: 10, deep: 5, ground: 1, miss: 0 };

// ─── 16-bit colour palette ────────────────────────────────────
const P = {
  // Sky bands (dark→light, top→bottom)
  sky:  ['#1828A0','#2038B0','#3050C4','#4468D8','#6080E0'],
  // Sun
  sun:  '#F8D020',
  // Clouds
  cld:  '#C8D8F8',
  // Bleachers / stands
  blchDk: '#604820', blchMd: '#805830', blchLt: '#A07040',
  // Seats
  shtR: '#C82020', shtB: '#203898', shtG: '#1E701E', shtY: '#C89020',
  // Outfield wall & fence
  wall:  '#145014', wallHi: '#208020', wallBrd: '#0C3C0C',
  // Foul poles
  pole:  '#F8E020',
  // Warning track (clay)
  trk:   '#B06828',
  // Grass
  g0:    '#157015',  // dark stripe
  g1:    '#27A027',  // light stripe
  // Infield dirt
  drt:   '#9A6828', drtDk: '#7A5020',
  // Chalk
  chalk: '#F4F0DC',
  // Team colours
  blue:  '#0830B8', ltBlue:'#3060D8', navy:'#041060',
  white: '#F0F0F0', offWht:'#E0DCC8',
  gold:  '#F8C020', dkGold:'#C09010',
  red:   '#C82020',
  // Skin tones
  skin:  '#F0C898', skinDk:'#C08050',
  // HUD
  hudBg: '#060618', hudBrd:'#F8C020',
  // Hit outcomes
  clrHR:   '#F8E040', clrDeep:'#70B8FF',
  clrGnd:  '#70E070', clrMiss:'#909090',
  // Misc
  black: '#080808', shadow:'rgba(0,0,0,0.35)',
};

// ─── State ────────────────────────────────────────────────────
let state = {};

function resetState() {
  state = {
    phase: 'idle',
    score: 0, pitchesLeft: TOTAL_PITCHES, homeRuns: 0,
    hitLog: [],
    pitchT: 0, swung: false, lastOutcome: null,
    resultTimer: 0,
    batSwing: 0, batSwinging: false,
    ballAnim: null,
    ballSpin: 0,         // cumulative rotation angle for seam spin
    confetti: [],
    flashMsg: '', flashColor: P.gold, flashTimer: 0,
    crowdT: 0,
    crowdExcited: 0,     // 0-1, peaks on HR, fades out
    contactFlash: 0,     // brief white flash at contact point
    contactX: 0, contactY: 0,
    hrDistance: 0,       // feet, set on HR outcome
  };
}

// ─── DOM ──────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const swingZ = document.getElementById('swingZone');

const screens = {
  start: document.getElementById('startScreen'),
  game:  document.getElementById('gameScreen'),
  end:   document.getElementById('endScreen'),
};

// ─── Canvas init ──────────────────────────────────────────────
canvas.width  = LW;
canvas.height = LH;
ctx.imageSmoothingEnabled = false;

// ─── Audio ────────────────────────────────────────────────────
let audioCtx = null;
function getAC() {
  if (!audioCtx) try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){}
  return audioCtx;
}
function tone(freq,type,dur,vol,delay) {
  const ac=getAC(); if(!ac) return;
  const t0=ac.currentTime+(delay||0);
  const o=ac.createOscillator(), g=ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type=type||'square'; o.frequency.setValueAtTime(freq,t0);
  g.gain.setValueAtTime(vol||0.2,t0);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  o.start(t0); o.stop(t0+dur+0.05);
}
const sndCrack = () => { tone(280,'sawtooth',0.05,0.5); tone(560,'square',0.04,0.3,0.02); tone(1100,'sine',0.07,0.2,0.01); };
const sndMiss  = () => { tone(160,'sine',0.28,0.14); tone(110,'sine',0.35,0.09,0.14); };
const sndHR    = () => [523,659,784,880,1047].forEach((f,i)=>tone(f,'square',0.2,0.28,i*0.12));
const sndPitch = () => tone(240,'sine',0.05,0.1);

function sndCrowdCheer(intensity) {
  // Synthesized crowd roar: filtered noise burst with rise-sustain-fall envelope
  const ac = getAC(); if (!ac) return;
  intensity = intensity || 1;
  const dur = intensity > 0.7 ? 2.8 : 1.4;
  const bufSize = ac.sampleRate * (dur + 0.5);
  const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  // Bandpass filter centered around crowd-voice freq range
  const bp1 = ac.createBiquadFilter();
  bp1.type = 'bandpass'; bp1.frequency.value = 800; bp1.Q.value = 0.6;
  const bp2 = ac.createBiquadFilter();
  bp2.type = 'bandpass'; bp2.frequency.value = 2200; bp2.Q.value = 0.5;
  const gainNode = ac.createGain();
  const t0 = ac.currentTime + 0.05;
  const peak = intensity * 0.38;
  gainNode.gain.setValueAtTime(0.001, t0);
  gainNode.gain.linearRampToValueAtTime(peak, t0 + 0.25);        // rise
  gainNode.gain.setValueAtTime(peak, t0 + dur * 0.55);           // sustain
  gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + dur);   // fade
  src.connect(bp1); bp1.connect(bp2); bp2.connect(gainNode);
  gainNode.connect(ac.destination);
  src.start(t0); src.stop(t0 + dur + 0.1);
  // Layered second source for richer texture
  const src2 = ac.createBufferSource();
  const buf2 = ac.createBuffer(1, bufSize, ac.sampleRate);
  const data2 = buf2.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data2[i] = Math.random() * 2 - 1;
  src2.buffer = buf2;
  const bp3 = ac.createBiquadFilter();
  bp3.type = 'bandpass'; bp3.frequency.value = 1400; bp3.Q.value = 0.4;
  const gain2 = ac.createGain();
  gain2.gain.setValueAtTime(0.001, t0 + 0.1);
  gain2.gain.linearRampToValueAtTime(peak * 0.7, t0 + 0.4);
  gain2.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.9);
  src2.connect(bp3); bp3.connect(gain2); gain2.connect(ac.destination);
  src2.start(t0 + 0.1); src2.stop(t0 + dur + 0.1);
}

// ─── Screen management ────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k,el]) => el.classList.toggle('active', k===name));
}

// ─── Pixel helpers ────────────────────────────────────────────
const $ = (x,y,w,h,c) => { ctx.fillStyle=c; ctx.fillRect(~~x,~~y,Math.ceil(w),Math.ceil(h)); };
function line(x1,y1,x2,y2,c,w) {
  ctx.strokeStyle=c; ctx.lineWidth=w||1;
  ctx.beginPath(); ctx.moveTo(~~x1,~~y1); ctx.lineTo(~~x2,~~y2); ctx.stroke();
}
function txt(t,x,y,c,sz,align) {
  ctx.fillStyle=c; ctx.font=`bold ${sz||9}px monospace`;
  ctx.textAlign=align||'left'; ctx.fillText(t,~~x,~~y);
}
function txtC(t,x,y,c,sz) { txt(t,x,y,c,sz,'center'); }

// ─── Math helpers ─────────────────────────────────────────────
function lerp(a,b,t){ return a+(b-a)*t; }
// Smooth swing easing: slow start, fast middle, slow end
function easeInOut(t){ return t<0.5 ? 2*t*t : -1+(4-2*t)*t; }
// Ease out for snappy feel
function easeOut(t){ return 1-(1-t)*(1-t); }
// Given a depth fraction d (0=wall, 1=plate), return y coordinate
function fieldY(d){ return lerp(F.trackBot, F.plt.y, d); }
// Given a depth fraction and a lateral offset at plate, return x
function fieldX(d, plateOffset){ return lerp(VP.x, F.plt.x+plateOffset, d); }

// ─── Scene drawing ────────────────────────────────────────────

function drawSky() {
  const bands = P.sky;
  const bandH = (VP.y - 4) / bands.length;
  bands.forEach((c,i) => $(0, i*bandH, LW, bandH+1, c));
}

function drawSun() {
  // Pixel-style sun: square body + rays (pixels offset outward)
  const sx=272, sy=22, sr=14;
  // Glow
  $(sx-sr-4, sy-4, (sr+4)*2, sr*2+8, 'rgba(248,210,20,0.15)');
  // Body
  $(sx-sr, sy-sr, sr*2, sr*2, P.sun);
  // Face pixels (simple)
  $(sx-4, sy-3, 3, 3, '#C09010'); // eye L
  $(sx+1, sy-3, 3, 3, '#C09010'); // eye R
  $(sx-4, sy+3, 9, 2, '#C09010'); // smile
  // Rays (8 directions, pixel style)
  const rays = [[0,-1],[0,1],[1,0],[-1,0],[1,-1],[-1,-1],[1,1],[-1,1]];
  rays.forEach(([dx,dy]) => $(sx+dx*(sr+2), sy+dy*(sr+2), 6, 6, P.sun));
}


function drawBleachers() {
  // ── Upper deck (behind / higher) ──────────────────────────
  const udY=60, udH=40, margin=28;
  // Structure
  $(margin,   udY,   LW-margin*2, udH, P.blchDk);
  $(margin,   udY,   LW-margin*2, 3,   P.blchLt); // highlight cap
  // Upper deck seats (3 rows, many cols)
  const cols=20;
  const seatW=(LW-margin*2-4)/cols;
  const seatClrs=[P.shtB,P.shtR,P.shtY,P.shtG,P.shtB,P.shtB,P.shtR];
  for(let r=0;r<3;r++) {
    for(let c=0;c<cols;c++) {
      const sc=seatClrs[(r*7+c*3)%seatClrs.length];
      $(margin+2+c*seatW, udY+5+r*10, seatW-1, 7, sc);
    }
  }
  // Upper crowd heads (bobbing; jump up on HR)
  const excite = state.crowdExcited || 0;
  for(let i=0;i<24;i++) {
    const normalBob = (Math.sin(state.crowdT*0.003+i*1.1)>0.6) ? -2 : 0;
    // Excited: big upward jump, staggered by index
    const exciteBob = excite > 0
      ? -Math.max(0, Math.sin((state.crowdT*0.012 + i*0.4))) * 12 * excite
      : 0;
    const hx=margin+4+i*((LW-margin*2-8)/24);
    const hy=udY+2+normalBob+exciteBob;
    const skinT=[P.skin,P.skinDk,'#E0A870','#C07840','#F8D0B8'][i%5];
    $(hx,~~hy,5,5,skinT);
    $(hx-1,~~hy-3,7,3,[P.blue,P.red,P.shtY,P.shtG][i%4]);
    // Excited: tiny raised arms
    if(excite > 0.3){
      ctx.fillStyle=[P.skin,P.skinDk][i%2];
      const armA = Math.sin(state.crowdT*0.015+i)*0.5*excite;
      $(hx-3, ~~hy-1, 2, 4, [P.skin,P.skinDk][i%2]); // L arm up
      $(hx+6, ~~hy-1, 2, 4, [P.skin,P.skinDk][i%2]); // R arm up
    }
  }

  // ── Lower deck / bleachers ────────────────────────────────
  const ldY=98, ldH=30;
  $(8,   ldY, LW-16, ldH, P.blchMd);
  $(8,   ldY, LW-16, 2,   P.blchLt);
  // Seat rows
  for(let r=0;r<2;r++) {
    for(let c=0;c<cols;c++) {
      const sc=seatClrs[(r*5+c*4)%seatClrs.length];
      $( 10+c*((LW-20)/cols), ldY+4+r*11, (LW-20)/cols-1, 8, sc);
    }
  }
  // Lower crowd heads (bob + HR excitement)
  for(let i=0;i<22;i++) {
    const normalBob = (Math.sin(state.crowdT*0.004+i*0.85+1)>0.65) ? -2 : 0;
    const exciteBob = excite > 0
      ? -Math.max(0, Math.sin((state.crowdT*0.014 + i*0.5))) * 10 * excite
      : 0;
    const hx=12+i*((LW-24)/22);
    const hy=ldY+normalBob+exciteBob;
    const skinT=[P.skin,P.skinDk,'#E0B080','#D09060'][i%4];
    $(hx,~~hy,6,6,skinT);
    $(hx-1,~~hy-3,8,3,[P.blue,P.red,P.white,P.shtG][i%4]);
    if(excite > 0.3){
      $(hx-2, ~~hy, 2, 5, [P.skin,P.skinDk][i%2]);
      $(hx+6, ~~hy, 2, 5, [P.skin,P.skinDk][i%2]);
    }
  }
}

function drawScoreboard() {
  // Larger scoreboard centered on outfield wall
  const sbW=120, sbH=56, sbX=LW/2-sbW/2, sbY=F.wallY-sbH-2;
  // Background
  $(sbX, sbY, sbW, sbH, P.navy);
  // Header bar
  $(sbX, sbY, sbW, 16, '#0A1A5A');
  txtC('SD LITTLE LEAGUE', LW/2, sbY+11, P.gold, 7);
  // Divider
  $(sbX+2, sbY+16, sbW-4, 2, P.gold);
  // Two-column layout: SCORE | PITCHES
  const colMid = sbX + sbW/2;
  // Left column: SCORE
  txtC('SCORE', sbX + sbW/4, sbY+28, '#8AA8D0', 6);
  txtC(String(state.score).padStart(3,'0'), sbX + sbW/4, sbY+46, P.gold, 16);
  // Center divider
  $(colMid-1, sbY+18, 2, sbH-20, '#1A2A6A');
  // Right column: PITCHES
  txtC('LEFT', sbX + sbW*3/4, sbY+28, '#8AA8D0', 6);
  txtC(String(state.pitchesLeft), sbX + sbW*3/4, sbY+46, P.white, 16);
  // Gold border
  ctx.strokeStyle=P.gold; ctx.lineWidth=2;
  ctx.strokeRect(~~sbX+1,~~sbY+1,~~sbW-2,~~sbH-2);
}

function drawOutfieldWall() {
  // Main wall face
  $(6, F.wallY, LW-12, F.wallBot-F.wallY, P.wall);
  // Top rail highlight
  $(6, F.wallY, LW-12, 2, P.wallHi);
  // Board segments
  for(let bx=8; bx<LW-8; bx+=12) {
    line(bx, F.wallY, bx, F.wallBot, P.wallBrd, 1);
  }
  // Padding squares (alternate) - cartoon look
  for(let px=16; px<LW-16; px+=24) {
    $(px, F.wallY+2, 18, 8, '#1A6020');
  }
  // ── Distance markers ───────────────────────────────────────
  // Left field (340)
  $(18, F.wallY+3, 24, 10, P.navy);
  txtC('340', 30, F.wallY+11, P.white, 7);
  // Center field (400) — above scoreboard
  // Right field (330)
  $(278, F.wallY+3, 24, 10, P.navy);
  txtC('330', 290, F.wallY+11, P.white, 7);
  // Center field marker on wall (small sign between scoreboard gap)
  const cfX = LW/2;
  $(cfX-14, F.wallY+3, 28, 10, '#0A1A5A');
  txtC('400', cfX, F.wallY+11, P.gold, 7);
}

function drawFoulPoles() {
  // Left pole
  line(F.lPoleBase.x, F.lPoleBase.y, F.lPoleTop.x, F.lPoleTop.y, P.pole, 3);
  // Pennant flag at top
  ctx.fillStyle=P.pole;
  ctx.beginPath();
  ctx.moveTo(F.lPoleTop.x, F.lPoleTop.y);
  ctx.lineTo(F.lPoleTop.x+10, F.lPoleTop.y+4);
  ctx.lineTo(F.lPoleTop.x, F.lPoleTop.y+8);
  ctx.fill();
  // Right pole
  line(F.rPoleBase.x, F.rPoleBase.y, F.rPoleTop.x, F.rPoleTop.y, P.pole, 3);
  ctx.beginPath();
  ctx.moveTo(F.rPoleTop.x, F.rPoleTop.y);
  ctx.lineTo(F.rPoleTop.x-10, F.rPoleTop.y+4);
  ctx.lineTo(F.rPoleTop.x, F.rPoleTop.y+8);
  ctx.fill();
}

function drawWarningTrack() {
  // Clay-coloured trapezoid between wall and grass
  ctx.fillStyle = P.trk;
  ctx.beginPath();
  ctx.moveTo(F.lWallX,  F.wallBot);
  ctx.lineTo(F.rWallX,  F.wallBot);
  ctx.lineTo(F.rWallX+8,F.trackBot);
  ctx.lineTo(F.lWallX-8,F.trackBot);
  ctx.closePath();
  ctx.fill();
  // Subtle texture dots
  ctx.fillStyle = P.drtDk;
  for(let dx=20;dx<LW-20;dx+=8) {
    for(let dy=F.wallBot+2;dy<F.trackBot;dy+=5) {
      if((dx+dy)%14===0) $(dx,dy,2,2,P.drtDk);
    }
  }
}

function drawField() {
  // Full grass trapezoid (outfield + infield base layer)
  const stripes = 12;
  const topL=F.lWallX-8, topR=F.rWallX+8, topY=F.trackBot;
  const botL=0, botR=LW, botY=LH;

  for(let s=0;s<stripes;s++) {
    const t0=s/stripes, t1=(s+1)/stripes;
    const x0L=lerp(topL,botL,t0), x0R=lerp(topR,botR,t0), y0=lerp(topY,botY,t0);
    const x1L=lerp(topL,botL,t1), x1R=lerp(topR,botR,t1), y1=lerp(topY,botY,t1);
    const col = s%2===0 ? P.g0 : P.g1;
    ctx.fillStyle=col;
    ctx.beginPath();
    ctx.moveTo(~~x0L,~~y0); ctx.lineTo(~~x0R,~~y0);
    ctx.lineTo(~~x1R,~~y1); ctx.lineTo(~~x1L,~~y1);
    ctx.closePath(); ctx.fill();
  }

  // ── Center-field circle mowing pattern ─────────────────────
  // Two concentric lighter rings give a classic mowed-circle look
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = P.g1;
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(VP.x, VP.y+70, 68, 0, Math.PI*2); ctx.stroke();
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(VP.x, VP.y+70, 42, 0, Math.PI*2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── Foul territory dirt strips (beside batter's boxes) ──────
  // Left foul territory
  ctx.fillStyle = P.drt;
  ctx.beginPath();
  ctx.moveTo(F.plt.x, F.plt.y);
  ctx.lineTo(F.lWallX, F.wallBot);
  ctx.lineTo(F.lWallX-8, F.trackBot);
  ctx.lineTo(0, LH);
  ctx.lineTo(0, F.plt.y);
  ctx.closePath(); ctx.fill();
  // Right foul territory
  ctx.beginPath();
  ctx.moveTo(F.plt.x, F.plt.y);
  ctx.lineTo(F.rWallX, F.wallBot);
  ctx.lineTo(F.rWallX+8, F.trackBot);
  ctx.lineTo(LW, LH);
  ctx.lineTo(LW, F.plt.y);
  ctx.closePath(); ctx.fill();

  // Foul lines (white chalk) from home plate to wall corners
  ctx.strokeStyle=P.chalk; ctx.lineWidth=1.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(F.plt.x, F.plt.y); ctx.lineTo(F.lWallX, F.wallBot); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(F.plt.x, F.plt.y); ctx.lineTo(F.rWallX, F.wallBot); ctx.stroke();
}

function drawInfield() {
  // ── Dirt diamond (perspective quadrilateral) ──────────────
  ctx.fillStyle=P.drt;
  ctx.beginPath();
  ctx.moveTo(F.plt.x,  F.plt.y);          // home
  ctx.lineTo(F.b1.x+12, F.b1.y);          // past 1st
  ctx.lineTo(F.b2.x,   F.b2.y-8);         // past 2nd
  ctx.lineTo(F.b3.x-12, F.b3.y);          // past 3rd
  ctx.closePath();
  ctx.fill();
  // Darker shading on far side of diamond
  ctx.fillStyle=P.drtDk;
  ctx.beginPath();
  ctx.moveTo(F.b2.x,   F.b2.y-8);
  ctx.lineTo(F.b1.x+12, F.b1.y);
  ctx.lineTo(F.b1.x,   F.b1.y+14);
  ctx.lineTo(F.b2.x,   F.b2.y+2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle=P.drtDk;
  ctx.beginPath();
  ctx.moveTo(F.b2.x,   F.b2.y-8);
  ctx.lineTo(F.b3.x-12, F.b3.y);
  ctx.lineTo(F.b3.x,   F.b3.y+14);
  ctx.lineTo(F.b2.x,   F.b2.y+2);
  ctx.closePath();
  ctx.fill();

  // ── Grass cutout inside baselines ─────────────────────────
  // (small infield grass area between the dirt)
  ctx.fillStyle=P.g1;
  ctx.beginPath();
  ctx.moveTo(F.plt.x,  F.plt.y-20);
  ctx.lineTo(F.b1.x,  F.b1.y);
  ctx.lineTo(F.b2.x,  F.b2.y);
  ctx.lineTo(F.b3.x,  F.b3.y);
  ctx.closePath();
  ctx.fill();

  // ── Pitcher's mound ───────────────────────────────────────
  // Worn path from mound to home (center strip)
  ctx.fillStyle = 'rgba(122,80,32,0.35)';
  ctx.beginPath();
  ctx.moveTo(F.mnd.x-5, F.mnd.y+6);
  ctx.lineTo(F.plt.x-4,  F.plt.y-14);
  ctx.lineTo(F.plt.x+4,  F.plt.y-14);
  ctx.lineTo(F.mnd.x+5, F.mnd.y+6);
  ctx.closePath(); ctx.fill();
  // Mound base shadow
  ctx.fillStyle=P.drtDk;
  ctx.beginPath(); ctx.ellipse(F.mnd.x,F.mnd.y,22,9,0,0,Math.PI*2); ctx.fill();
  // Mound body
  ctx.fillStyle=P.drt;
  ctx.beginPath(); ctx.ellipse(F.mnd.x,F.mnd.y-2,18,7,0,0,Math.PI*2); ctx.fill();
  // Top highlight (lighter dirt at top of mound)
  ctx.fillStyle='#AE7A38';
  ctx.beginPath(); ctx.ellipse(F.mnd.x,F.mnd.y-3,12,4,0,0,Math.PI*2); ctx.fill();
  // Pitcher's rubber
  $(F.mnd.x-6, F.mnd.y-5, 12, 3, P.chalk);
  // Rubber shadow
  $(F.mnd.x-6, F.mnd.y-2, 12, 1, '#A0A090');

  // ── Base paths (chalk) ────────────────────────────────────
  ctx.strokeStyle=P.chalk; ctx.lineWidth=1.2; ctx.setLineDash([3,3]);
  // Home → 1st
  ctx.beginPath(); ctx.moveTo(F.plt.x,F.plt.y); ctx.lineTo(F.b1.x,F.b1.y); ctx.stroke();
  // 1st → 2nd
  ctx.beginPath(); ctx.moveTo(F.b1.x,F.b1.y); ctx.lineTo(F.b2.x,F.b2.y); ctx.stroke();
  // Home → 3rd
  ctx.beginPath(); ctx.moveTo(F.plt.x,F.plt.y); ctx.lineTo(F.b3.x,F.b3.y); ctx.stroke();
  // 3rd → 2nd
  ctx.beginPath(); ctx.moveTo(F.b3.x,F.b3.y); ctx.lineTo(F.b2.x,F.b2.y); ctx.stroke();
  ctx.setLineDash([]);

  // ── Bases ─────────────────────────────────────────────────
  [[F.b1.x,F.b1.y,12],[F.b3.x,F.b3.y,12],[F.b2.x,F.b2.y,10]].forEach(([bx,by,sz]) => {
    const h = ~~(sz/2);
    // Base shadow
    ctx.fillStyle='rgba(0,0,0,0.22)';
    ctx.save(); ctx.translate(bx+2,by+2); ctx.rotate(Math.PI/4);
    ctx.fillRect(-h,-h,sz,sz); ctx.restore();
    // Base body
    ctx.fillStyle=P.offWht;
    ctx.save(); ctx.translate(bx,by); ctx.rotate(Math.PI/4);
    ctx.fillRect(-h,-h,sz,sz); ctx.restore();
    // Base border
    ctx.strokeStyle='#C0BCA0'; ctx.lineWidth=1;
    ctx.save(); ctx.translate(bx,by); ctx.rotate(Math.PI/4);
    ctx.strokeRect(-h,-h,sz,sz); ctx.restore();
    // Stitching line across base
    ctx.strokeStyle='rgba(180,176,160,0.6)'; ctx.lineWidth=0.8;
    ctx.save(); ctx.translate(bx,by); ctx.rotate(Math.PI/4);
    ctx.beginPath(); ctx.moveTo(-h+2,0); ctx.lineTo(h-2,0); ctx.stroke();
    ctx.restore();
  });
}

function drawBatterBox() {
  // Chalk batter's boxes flanking home plate
  ctx.strokeStyle=P.chalk; ctx.lineWidth=1.2; ctx.setLineDash([]);
  // Right batter box (for right-handed batter — our side)
  ctx.strokeRect(F.plt.x+2, F.plt.y-36, 28, 40);
  // Left batter box (opposite, for lefties)
  ctx.strokeRect(F.plt.x-30, F.plt.y-36, 28, 40);
  // Catcher's box (behind plate)
  ctx.strokeRect(F.plt.x-18, F.plt.y+2, 36, 22);
}

function drawHomePlate() {
  const px=F.plt.x, py=F.plt.y;
  // Plate shadow
  ctx.fillStyle='rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(px+2,    py-8);
  ctx.lineTo(px+14,   py+2);
  ctx.lineTo(px+14,   py+12);
  ctx.lineTo(px-10,   py+12);
  ctx.lineTo(px-10,   py+2);
  ctx.closePath(); ctx.fill();
  // Plate body
  ctx.fillStyle=P.chalk;
  ctx.beginPath();
  ctx.moveTo(px,       py-10);
  ctx.lineTo(px+12,    py);
  ctx.lineTo(px+12,    py+10);
  ctx.lineTo(px-12,    py+10);
  ctx.lineTo(px-12,    py);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#B0ACA0'; ctx.lineWidth=1;
  ctx.stroke();
  // Center seam
  ctx.strokeStyle='rgba(160,155,140,0.5)'; ctx.lineWidth=0.8;
  ctx.beginPath(); ctx.moveTo(px, py-9); ctx.lineTo(px, py+9); ctx.stroke();
}

function drawStrikeZone(alpha) {
  // Translucent box showing strike zone
  const szX=F.plt.x-15, szY=LH*0.44, szW=30, szH=38;
  ctx.save(); ctx.globalAlpha=alpha||0.28;
  ctx.fillStyle='rgba(255,255,255,0.1)';
  ctx.fillRect(~~szX,~~szY,szW,szH);
  ctx.strokeStyle=P.chalk; ctx.lineWidth=1; ctx.setLineDash([2,2]);
  ctx.strokeRect(~~szX,~~szY,szW,szH);
  ctx.setLineDash([]); ctx.restore();
}

// ─── Palm trees (San Diego touch) ────────────────────────────
function drawPalm(cx, baseY, ht) {
  // Trunk (tapered)
  const tw=Math.max(2, ~~(ht*0.06));
  ctx.fillStyle='#7A5A2A';
  for(let seg=0;seg<5;seg++) {
    const f=seg/5, f2=(seg+1)/5;
    const y0=baseY-ht*f, y1=baseY-ht*f2;
    const x0=cx-tw, x1=cx+tw;
    ctx.fillRect(~~x0,~~y1,tw*2,~~(y0-y1)+1);
    // bark stripe
    if(seg%2===0) ctx.fillStyle='#6A4A1A'; else ctx.fillStyle='#7A5A2A';
  }
  // Fronds (pixel rectangles at angles)
  const frondC=['#157015','#1A8A1A','#20A020','#128012'];
  const fronds=[[-40,-28],[-26,-38],[-8,-42],[10,-42],[26,-38],[40,-28],[50,-14],[-50,-14]];
  fronds.forEach(([dx,dy],i)=>{
    const ex=cx+dx, ey=(baseY-ht)+dy;
    const mx=(cx+ex)/2+dy*0.15, my=((baseY-ht)+ey)/2-Math.abs(dx)*0.2;
    ctx.fillStyle=frondC[i%frondC.length];
    ctx.beginPath();
    ctx.moveTo(cx,baseY-ht);
    ctx.quadraticCurveTo(mx,my,ex,ey);
    ctx.lineWidth=Math.max(2,~~(ht*0.05));
    ctx.strokeStyle=frondC[i%frondC.length];
    ctx.stroke();
  });
}

// ─── Pitcher sprite ───────────────────────────────────────────
// Pitcher faces the batter (front view). All y-coords are offsets
// from cy. Body parts are laid out so each piece connects to the next:
//   cap top -52 → crown -44 → head -44…-30 → neck -30…-22
//   → jersey -22…-2 → belt -2 → pants -2…10 → legs 10…22 → cleats 22…30
function drawPitcher(pitchT) {
  const cx = F.mnd.x, cy = F.mnd.y - 8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';

  // ── Ground shadow ──────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(2, 28, 15, 4, 0, 0, Math.PI*2); ctx.fill();

  // ── PIVOT FOOT (right — stays on rubber) ──────────────────
  $(-8, 22, 17, 7, '#141414');     // sole
  $(-6, 16, 14, 8, '#252525');     // upper
  $(-4, 15, 10, 3, P.white);       // accent stripe
  for(let s=0;s<3;s++) $(-5+s*5, 28, 3, 2, '#444'); // cleats

  // ── STRIDE LEG (left — kicks up, then drives forward) ─────
  // kneeLift: 0 at rest, peaks mid-windup, returns to 0 at follow-through
  const kneeLift = Math.max(0, Math.sin(Math.min(Math.PI, pitchT * Math.PI / 0.45)) * 16);
  const strideX  = lerp(-2, 14, Math.max(0, (pitchT - 0.4) / 0.4));
  const footY    = lerp(22 - kneeLift * 0.5, 24, Math.max(0, (pitchT - 0.4) / 0.5));

  ctx.strokeStyle = P.white; ctx.lineWidth = 6;
  // thigh
  ctx.beginPath(); ctx.moveTo(2, 10); ctx.lineTo(8, 12 - kneeLift); ctx.stroke();
  // shin
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(8, 12 - kneeLift); ctx.lineTo(strideX, footY); ctx.stroke();
  // stirrup on stride leg
  $(strideX - 4, footY - 4, 10, 3, P.blue);
  // stride cleat
  $(strideX - 7, footY,  15, 7, '#141414');
  $(strideX - 5, footY - 5, 12, 6, '#252525');

  // ── PANTS / HIPS ──────────────────────────────────────────
  $(-9,  2, 20, 10, P.white);   // hips
  $(-7, 10, 16, 14, P.white);   // pivot-leg pants (right)
  // stirrup on pivot leg
  $(-6, 17, 13, 3, P.blue);

  // ── BELT ──────────────────────────────────────────────────
  $(-11, 1, 24, 3, '#1A1A1A');
  $( -3,-1,  8, 5, '#5A5A5A');  // buckle plate
  $( -1, 0,  4, 3, P.gold);     // buckle glint

  // ── JERSEY (Dodger blue, front-facing) ────────────────────
  $(-11, -22, 23, 24, P.blue);  // body  ← bottom at y=-22 connects to belt top
  // Side-panel shading for depth
  $(-11, -22,  3, 24, P.navy);
  $(  9, -22,  3, 24, P.navy);
  // White centre placket
  $( -2, -22,  5, 18, '#A0AEDD');
  $( -1, -22,  3, 18, P.white);
  // Jersey number
  txtC('12', 0, -8, P.white, 8);

  // ── GLOVE ARM (left — rises in windup, drops after release) ─
  const gloveRise = pitchT < 0.45
    ? Math.sin(pitchT * Math.PI / 0.45) * 11
    : Math.max(0, (1 - pitchT) * 8);
  ctx.strokeStyle = P.skin; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-11, -14); ctx.lineTo(-18, -18 - gloveRise); ctx.stroke();
  // Glove body
  ctx.fillStyle = '#7A4820';
  ctx.beginPath(); ctx.ellipse(-19, -22 - gloveRise, 7, 5, -0.3, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#5A3010';
  ctx.beginPath(); ctx.ellipse(-19, -22 - gloveRise, 4, 3, -0.3, 0, Math.PI*2); ctx.fill();
  // Glove web stitching
  ctx.strokeStyle = '#9A6030'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(-19, -22 - gloveRise, 4, 0.1, Math.PI - 0.1); ctx.stroke();

  // ── THROWING ARM (right — cocks back, whips through) ──────
  const armA = pitchT < 0.18
    ? lerp(-1.3, -2.1, pitchT / 0.18)           // arm cocks back overhead
    : pitchT < 0.62
    ? lerp(-2.1,  1.1, (pitchT-0.18) / 0.44)    // whips through on release
    : lerp( 1.1,  0.5, (pitchT-0.62) / 0.38);   // follow-through
  ctx.save();
  ctx.translate(11, -15);
  ctx.rotate(armA);
  ctx.strokeStyle = P.skin; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 16); ctx.stroke();
  // Ball in hand before release
  if(pitchT < 0.1) {
    ctx.fillStyle = P.offWht;
    ctx.beginPath(); ctx.arc(0, 19, 5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#CC6060'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-1, 19, 3, 0.3, 1.5); ctx.stroke();
  }
  ctx.restore();

  // ── NECK (y: -30 to -22 — sits directly on jersey top) ────
  $(-5, -30, 11, 9, P.skin);   // ← bottom at y=-21 overlaps jersey top at -22, no gap
  // Collar (blue band bridging jersey↔neck)
  $(-8, -24,  17, 4, P.blue);

  // ── HEAD (y: -44 to -30 — sits on neck top) ───────────────
  $(-9, -44, 19, 15, P.skin);  // ← bottom at y=-29 overlaps neck top, sealed
  // Jaw / chin shading
  $(-8, -31, 18, 2, P.skinDk);
  // Ears
  $(-11, -41, 3, 7, P.skin);
  $(  8, -41, 3, 7, P.skin);
  // Eyes (whites + pupils)
  $(-6, -40, 5, 4, '#F8F8F8');   // L white
  $( 2, -40, 5, 4, '#F8F8F8');   // R white
  $(-5, -39, 3, 3, '#181818');   // L pupil
  $( 3, -39, 3, 3, '#181818');   // R pupil
  // Eyebrows (game-face focus)
  $(-6, -42, 5, 2, '#603020');
  $( 2, -42, 5, 2, '#603020');
  // Mouth / grimace
  $(-3, -34, 7, 2, '#B06050');
  // Nose bridge
  $(-1, -38, 3, 4, P.skinDk);

  // ── CAP (y: -53 to -44 — sits on head top) ────────────────
  $(-11, -53, 23, 10, P.blue);  // ← bottom at -43 overlaps head top at -44, sealed
  // Cap shadow panel
  $(-9,  -51, 19,  8, P.navy);
  // Brim (extends forward from front face of cap)
  $(-12, -45, 25,  4, P.navy);
  $(-10, -43, 21,  2, '#0A0A40'); // brim underside
  // Button + top detail
  $(-3, -55,  7,  3, P.navy);
  $(-1, -55,  3,  2, P.gold);

  ctx.restore();
}

// ─── Batter (right-handed, jersey #3) full figure from behind ─
// Camera is slightly above & behind home plate, batter faces pitcher.
// From this angle we see the player's back.
// RHB: right shoulder (3B side) = screen LEFT; left (1B) = screen RIGHT.
function drawBatter() {
  // Smaller figure, positioned to the right side of screen
  const ax = LW - 76, ay = LH - 14;
  const SCALE = 0.60;   // scale down from the full-size drawing coords

  const sf   = state.batSwinging ? easeInOut(Math.min(1, state.batSwing)) : 0;
  const batA = lerp(-0.52, 1.58, sf);
  const lean = lerp(0, 0.06, sf);

  ctx.save();
  ctx.translate(ax, ay);
  ctx.scale(SCALE, SCALE);
  ctx.rotate(lean);

  // ── Ground shadow ────────────────────────────────────────
  ctx.fillStyle='rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(2,-2,28,7,0,0,Math.PI*2); ctx.fill();

  // ── Cleats ───────────────────────────────────────────────
  // Left (screen-left = batter's right / 3B side): rear foot, slightly bigger
  $(-24,-14, 24, 9, '#141414');   // sole
  $(-22,-20, 20, 8, '#222');      // upper
  $(-20,-22, 16, 4, P.white);     // accent stripe
  $(-22,-13,  3, 3, '#555');      // cleat stud
  $(-16,-13,  3, 3, '#555');
  $(-10,-13,  3, 3, '#555');
  // Right (screen-right = batter's left / 1B side): stride foot
  $(  4,-12, 24, 8, '#141414');
  $(  6,-17, 20, 7, '#222');
  $(  8,-19, 16, 4, P.white);
  $(  6,-11,  3, 3, '#555');
  $( 12,-11,  3, 3, '#555');
  $( 18,-11,  3, 3, '#555');

  // ── Socks (white with blue stirrups) ─────────────────────
  $(-24,-50, 22, 36, P.white);    // L sock
  $(  4,-48, 22, 36, P.white);    // R sock
  $(-22,-38, 18,  4, P.blue);     // L stirrup
  $(  6,-36, 18,  4, P.blue);     // R stirrup
  $(-22,-32, 18,  3, P.blue);
  $(  6,-30, 18,  3, P.blue);

  // ── Pants (white baseball pants) ─────────────────────────
  $(-26,-90, 24, 42, P.white);    // L leg
  $(  4,-88, 24, 40, P.white);    // R leg
  $( -4,-89, 10, 40, P.white);    // center fill
  // Seam/crease shading
  $(-26,-88,  2, 38, '#D8D4C8');
  $( 26,-86,  2, 36, '#D8D4C8');
  $( -6,-88,  2, 38, '#E4E0D4');
  $(  4,-86,  2, 36, '#E4E0D4');

  // ── Belt ─────────────────────────────────────────────────
  $(-28,-95, 58,  5, '#1A1A1A');
  // Buckle
  $( -5,-97,  10, 8, '#5A5A5A');
  $( -3,-96,   6, 6, P.gold);
  $( -1,-95,   2, 4, '#8A6800');

  // ── Jersey back (white Dodger pinstripes) ─────────────────
  // Main body
  $(-28,-170, 58, 76, P.white);
  // Pinstripes (thin blue lines every 8px)
  for(let p=-26; p<28; p+=8){
    $(p,-170, 2, 76, '#9AA8E0');
  }
  // Side seams (solid blue)
  $(-30,-170, 4, 76, P.blue);
  $( 28,-170, 4, 76, P.blue);
  // Jersey hem
  $(-28,-97, 58,  3, '#D8D4C0');
  // Shoulder yoke (blue panel across top)
  $(-30,-170, 62, 14, P.blue);
  $(-28,-158,  6, 10, P.blue);   // L sleeve top
  $( 24,-158,  6, 10, P.blue);   // R sleeve top

  // Number "3" on back — big and clear
  ctx.fillStyle = P.blue;
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('3', 1, -120);

  // ── Shoulders & upper arms ───────────────────────────────
  // Left upper arm (3B side, larger / closer to camera)
  $(-40,-162, 16, 40, P.skin);
  $(-38,-162,  3, 38, P.blue);   // sleeve edge
  // Right upper arm (1B side)
  $( 26,-160, 16, 38, P.skin);
  $( 38,-162,  3, 36, P.blue);   // sleeve edge

  // ── Forearms (foreshortened — both arms converge to back shoulder grip) ─
  // L forearm (back/3B side): drops from upper arm into the grip area
  $(-36,-130, 12, 22, P.skin);
  $(-34,-125, 10,  5, P.skinDk); // inner forearm shadow
  // R forearm (front/1B side): reaches across from the other shoulder
  $( 24,-128, 14, 20, P.skin);
  $( 24,-122, 10,  5, P.skinDk); // inner forearm shadow
  // Wrist-band (compression sleeve edge on L arm)
  $(-36,-112,  12, 3, '#A0A4C0');

  // ── Neck (turned left — batter looking toward pitcher) ──────
  $(-8,-196, 14, 22, P.skin);       // main neck column
  $(-14,-194,  7, 16, P.skin);      // left side of neck visible (profile turn)
  $(-15,-191,  5,  8, P.skinDk);    // neck shadow where it curves away
  // Jersey collar
  $(-10,-174, 22,  5, P.blue);

  // ── Helmet (head turned left — brim toward pitcher) ──────────
  // Dome (shifted slightly left to sell the turn)
  $(-25,-222, 46, 28, P.blue);      // lower dome
  $(-21,-234, 38, 13, P.blue);      // mid dome
  $(-15,-242, 27,  9, P.blue);      // upper dome
  // Inner shadow for depth
  $(-21,-220, 38, 24, P.navy);
  $(-17,-232, 30, 12, P.navy);
  // ── Right cheek / jaw profile (camera-near side = screen-LEFT) ─
  // Since the head turns left, the batter's right cheek faces toward our camera
  $(-30,-212,  8, 20, P.skin);      // cheekbone
  $(-29,-207,  7, 14, P.skin);      // cheek fill
  $(-28,-195,  6,  7, P.skin);      // jaw / chin
  $(-28,-203,  4,  8, P.skinDk);    // jaw shadow line
  // Ear flap (screen-LEFT = 3B back side — stays prominent, close to camera)
  $(-34,-214, 12, 30, P.blue);
  $(-32,-210, 10, 25, P.navy);
  $(-32,-198,  8,  8, P.blue);      // flap bottom curve
  // Brim — faces pitcher (upper-LEFT in our behind-right view)
  $(-22,-192, 24,  5, P.navy);      // main brim shifted left toward pitcher
  $(-26,-196, 16,  5, P.navy);      // brim tip extending further left
  $(  0,-191, 10,  3, '#0A0A40');   // brim underside shadow (right edge)
  // Vent strips
  $(-12,-222,  3, 20, '#4858B0');
  $(  4,-222,  3, 20, '#4858B0');
  // Button on crown
  $( -5,-244,  7,  4, P.navy);
  $( -2,-245,  2,  2, P.white);     // pin dot

  // ── Bat (loads on back shoulder, hands stacked on handle) ────
  // Grip origin: where the two hands meet on the handle
  // For RHB loaded stance: hands near back (right) shoulder, around armpit height
  const gx = -20, gy = -118;

  // ── Top hand — batter's LEFT (skin), wraps above bottom hand ──
  // Dorsum (back of hand) faces camera-left, knuckle row visible
  $( gx-8, gy-11, 24, 10, P.skin);    // hand back / knuckles
  $( gx-6, gy-12, 20,  4, P.skinDk);  // knuckle ridge
  // Individual knuckle bumps
  for(let k=0;k<4;k++) $( gx-5+k*5, gy-13, 4, 3, P.skin );
  $( gx-8, gy- 2, 24,  8, P.skin);    // palm/wrist below knuckles
  $( gx-7, gy-  1, 22,  4, P.skinDk); // wrist crease

  // ── Bottom hand — batter's RIGHT, batting glove (navy) ────────
  $( gx-7, gy+ 6, 22, 13, P.navy);    // glove body
  $( gx-5, gy+ 7, 11,  3, '#5060A0'); // velcro strap L half
  $( gx+5, gy+ 7, 9,   3, '#5060A0'); // velcro strap R half
  $( gx-5, gy+10, 7,   2, '#383870'); // strap shadow
  // Finger padding (four pads across top of glove)
  for(let k=0;k<4;k++) $( gx-6+k*6, gy+18, 5, 4, '#383860');

  ctx.save();
  ctx.translate(gx, gy);
  ctx.rotate(batA);
  ctx.lineCap = 'round';

  // Knob
  ctx.fillStyle='#3C2010';
  ctx.beginPath(); ctx.arc(0,4,6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#5A3018';
  ctx.beginPath(); ctx.arc(0,2,4,0,Math.PI*2); ctx.fill();

  // Grip tape (black, with wrapped texture rings)
  ctx.strokeStyle='#1A1010'; ctx.lineWidth=7;
  ctx.beginPath(); ctx.moveTo(0,2); ctx.lineTo(0,-26); ctx.stroke();
  ctx.strokeStyle='#2A2020'; ctx.lineWidth=1;
  for(let g=0; g<7; g++){
    ctx.beginPath();
    ctx.moveTo(-4, -g*4-1);
    ctx.lineTo( 4, -g*4-1);
    ctx.stroke();
  }

  // Handle (natural wood, tapered)
  ctx.strokeStyle='#6B3A18'; ctx.lineWidth=7;
  ctx.beginPath(); ctx.moveTo(0,-24); ctx.lineTo(0,-58); ctx.stroke();

  // Taper zone
  ctx.strokeStyle='#7D4A22'; ctx.lineWidth=10;
  ctx.beginPath(); ctx.moveTo(0,-55); ctx.lineTo(0,-72); ctx.stroke();

  // Barrel (wide, rounded)
  ctx.strokeStyle='#9B6238'; ctx.lineWidth=17;
  ctx.beginPath(); ctx.moveTo(0,-70); ctx.lineTo(0,-94); ctx.stroke();
  // Second pass slightly lighter for depth
  ctx.strokeStyle='#A87248'; ctx.lineWidth=13;
  ctx.beginPath(); ctx.moveTo(-1,-71); ctx.lineTo(-1,-93); ctx.stroke();

  // End cap
  ctx.fillStyle='#B08050';
  ctx.beginPath(); ctx.arc(0,-94,10,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#C09060';
  ctx.beginPath(); ctx.arc(-1,-95,7,0,Math.PI*2); ctx.fill();

  // Barrel highlight (sheen down one side)
  ctx.strokeStyle='rgba(255,255,255,0.38)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(-5,-72); ctx.lineTo(-5,-92); ctx.stroke();

  // Wood grain lines
  ctx.strokeStyle='rgba(80,40,10,0.30)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(3,-72); ctx.lineTo(3,-90); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6,-76); ctx.lineTo(6,-88); ctx.stroke();

  // Brand stamp on barrel
  $(-5,-82, 10, 2, 'rgba(60,30,10,0.35)');

  ctx.restore(); // bat
  ctx.restore(); // body
}

// ─── Baseball (with spin animation) ──────────────────────────
function drawBall(x, y, size, spin) {
  const r  = Math.max(1.5, size/2);
  const s  = spin || 0;
  // Drop shadow (ellipse, offset)
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(~~x+4, ~~(y+r*0.7), ~~(r*0.85), ~~(r*0.38), 0, 0, Math.PI*2); ctx.fill();
  // Ball body
  ctx.fillStyle = P.offWht;
  ctx.beginPath(); ctx.arc(~~x, ~~y, Math.ceil(r), 0, Math.PI*2); ctx.fill();
  // Subtle edge shadow
  ctx.strokeStyle='rgba(160,155,140,0.55)'; ctx.lineWidth=1;
  ctx.stroke();
  // Seams (spin-driven: offset arcs rotate with s)
  if(r >= 4) {
    const sw = Math.max(1, ~~(r*0.13));
    ctx.strokeStyle='#CC5858'; ctx.lineWidth=sw;
    // Two C-curve seams, rotated by spin angle
    ctx.save();
    ctx.translate(~~x, ~~y);
    ctx.rotate(s);
    const sr = ~~(r*0.62);
    // seam 1
    ctx.beginPath(); ctx.arc(-~~(r*0.22), 0, sr, 0.25, 1.45); ctx.stroke();
    ctx.beginPath(); ctx.arc( ~~(r*0.22), 0, sr, Math.PI+0.25, Math.PI+1.45); ctx.stroke();
    ctx.restore();
  }
  // Specular highlight (fixed, not spinning)
  $(~~x - ~~(r*0.55) + ~~(r*0.18), ~~y - ~~(r*0.52),
    Math.max(2,~~(r*0.3)), Math.max(1,~~(r*0.22)), 'rgba(255,255,255,0.85)');
}

// ─── Contact flash effect ─────────────────────────────────────
function drawContactFlash() {
  if(state.contactFlash <= 0) return;
  const a = state.contactFlash;
  const r = (1-a) * 32 + 8;
  ctx.globalAlpha = a * 0.9;
  ctx.fillStyle = '#FFFFC0';
  ctx.beginPath(); ctx.arc(~~state.contactX, ~~state.contactY, ~~r, 0, Math.PI*2); ctx.fill();
  // Star burst lines
  ctx.strokeStyle = '#FFE040'; ctx.lineWidth = 2;
  for(let i=0; i<6; i++){
    const a2 = (i/6)*Math.PI*2;
    const d1 = r*0.6, d2 = r*1.2;
    ctx.beginPath();
    ctx.moveTo(state.contactX+Math.cos(a2)*d1, state.contactY+Math.sin(a2)*d1);
    ctx.lineTo(state.contactX+Math.cos(a2)*d2, state.contactY+Math.sin(a2)*d2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ─── Hit ball trajectory ──────────────────────────────────────
function buildTrajectory(outcome) {
  const pts=[], steps=36;
  const sx=BALL_END.x, sy=BALL_END.y;
  let ex, peakUp;
  switch(outcome) {
    case 'hr':    ex=LW/2+(Math.random()-0.5)*80; peakUp=LH*0.65; break;
    case 'deep':  ex=LW/2+(Math.random()-0.5)*100;peakUp=LH*0.42; break;
    default:      ex=LW/2+(Math.random()-0.5)*80; peakUp=LH*0.3;  break;
  }
  for(let i=0;i<=steps;i++) {
    const f=i/steps;
    pts.push({
      x: lerp(sx, ex, f),
      y: sy - 4*peakUp*f*(1-f),
      sz: lerp(BALL_SIZE_L, 5, f),
    });
  }
  state.ballAnim={ pts, t:0, speed: outcome==='hr' ? 0.019 : 0.027 };
}

function drawTrajectoryArc() {
  if(!state.ballAnim) return;
  const {pts,t} = state.ballAnim;
  const end=~~(t*pts.length);
  for(let i=1;i<end;i+=2) {
    const a=Math.max(0.1,0.5*(1-i/pts.length));
    ctx.globalAlpha=a;
    $(pts[i].x-1,pts[i].y-1,2,2,P.gold);
  }
  ctx.globalAlpha=1;
}

// ─── Confetti ─────────────────────────────────────────────────
function spawnConfetti() {
  state.confetti=[];
  for(let i=0;i<50;i++) {
    state.confetti.push({
      x:Math.random()*LW, y:10,
      vx:(Math.random()-0.5)*3, vy:1.5+Math.random()*2.5,
      c:[P.gold,P.red,P.blue,P.white,P.g1][~~(Math.random()*5)],
      w:3+~~(Math.random()*3), h:2+~~(Math.random()*2),
      life:1,
    });
  }
}
function drawConfetti(dt) {
  state.confetti=state.confetti.filter(c=>c.life>0&&c.y<LH+10);
  state.confetti.forEach(c=>{
    c.x+=c.vx; c.y+=c.vy; c.vy+=0.05; c.life-=0.005;
    ctx.globalAlpha=c.life;
    $(c.x,c.y,c.w,c.h,c.c);
  });
  ctx.globalAlpha=1;
}

// ─── HUD ──────────────────────────────────────────────────────
function drawHUD() {
  // ── Top bar background ────────────────────────────────────
  $(0, 0, LW, 26, P.hudBg);
  $(0, 25, LW, 2, P.gold);   // gold bottom border
  // Side accents
  $(0, 0, 3, 26, P.blue);
  $(LW-3, 0, 3, 26, P.blue);

  // ── Score (left) ──────────────────────────────────────────
  txt('SCORE', 6, 9, P.gold, 7);
  // Score value with leading zeros, white
  const scoreStr = String(state.score).padStart(3,'0');
  txt(scoreStr, 6, 22, P.white, 11);

  // ── HR dots (left of center) ──────────────────────────────
  // Small star/diamond for each home run
  const dotStartX = 76;
  txt('HR', dotStartX, 9, P.gold, 7);
  for(let d=0; d<state.homeRuns; d++){
    ctx.fillStyle = P.gold;
    const dx = dotStartX + d*9;
    ctx.beginPath(); ctx.arc(dx+3, 17, 4, 0, Math.PI*2); ctx.fill();
  }

  // ── Center: flash message or pitch indicator ───────────────
  if(state.flashTimer > 0){
    const fa = Math.min(1, state.flashTimer / 200);
    ctx.globalAlpha = fa;
    // Shadow
    ctx.fillStyle = P.black;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.flashMsg, LW/2+1, 18);
    // Colored text
    ctx.fillStyle = state.flashColor;
    ctx.fillText(state.flashMsg, LW/2, 17);
    ctx.globalAlpha = 1;
  } else if(state.phase === 'pitching'){
    // Blinking SWING during pitch
    if(((Date.now()/350|0)%2)===0){
      txtC('SWING!', LW/2, 18, '#FF4040', 10);
    }
  }

  // ── Pitches remaining (right) ─────────────────────────────
  txt('PITCHES', LW-60, 9, P.gold, 7);
  const pStr = String(state.pitchesLeft).padStart(2,'0');
  txt(pStr, LW-46, 22, P.white, 11);
  // Pitch pip row
  for(let p=0; p<TOTAL_PITCHES; p++){
    const px2 = LW-3 - p*5 - 4;
    const used = p >= state.pitchesLeft;
    ctx.fillStyle = used ? '#303030' : P.gold;
    ctx.fillRect(~~px2, 2, 3, 3);
  }
}

// ─── Timing meter ────────────────────────────────────────────
function drawTimingMeter(t) {
  const mx=6, my=LH-36, mw=LW-12, mh=16;

  // Outer frame
  $(mx-1,my-1,mw+2,mh+2, P.black);
  $(mx,  my,  mw,  mh,   '#1A0020');

  // Zone fills
  // Full red (miss) background
  $(mx+1, my+1, mw-2, mh-2, '#882020');
  // Good zones (green)
  const gL=~~(GOOD_MIN*(mw-2)),  gR=~~(GOOD_MAX*(mw-2));
  $(mx+1+gL, my+1, gR-gL, mh-2, '#1A8820');
  // Perfect zone (gold)
  const pL=~~(PERFECT_MIN*(mw-2)), pR=~~(PERFECT_MAX*(mw-2));
  $(mx+1+pL, my+1, pR-pL, mh-2, '#C09010');
  // Bright centre of perfect
  const pcX=~~((PERFECT_MIN+PERFECT_MAX)/2*(mw-2));
  $(mx+1+pcX-4, my+1, 8, mh-2, P.gold);

  // Zone labels
  ctx.fillStyle=P.black; ctx.font='bold 6px monospace'; ctx.textAlign='center';
  ctx.fillText('MISS',  mx+~~(0.15*(mw-2)),     my+mh-4);
  ctx.fillText('GOOD',  mx+~~(0.315*(mw-2)),    my+mh-4);
  ctx.fillText('PERFECT',mx+~~(0.64*(mw-2)),    my+mh-4);
  ctx.fillText('GOOD',  mx+~~(0.875*(mw-2)),    my+mh-4);
  ctx.fillText('MISS',  mx+~~(0.96*(mw-2)),     my+mh-4);

  // Indicator bar (position = pitchT, locked to ball travel)
  const indX=~~(mx+1+t*(mw-4));
  $(indX-2, my,   5, mh,   P.black);    // shadow
  $(indX-1, my+1, 4, mh-2, '#C0E8FF'); // body
  $(indX,   my+2, 2, mh-6, P.white);   // highlight

  // Blinking "TAP TO SWING" label
  if(((Date.now()/400|0)%2)===0) {
    txtC('[ TAP TO SWING ]', LW/2, my-3, P.white, 7);
  }
}

// ─── Scanlines (CRT effect) ───────────────────────────────────
function drawScanlines() {
  ctx.fillStyle='rgba(0,0,0,0.12)';
  for(let y=0;y<LH;y+=2) ctx.fillRect(0,y,LW,1);
}

// ─── Big hit result popup (drawn over field, below HUD) ───────
function drawResultPopup() {
  if(state.flashTimer <= 0 || state.phase !== 'result') return;
  const a = Math.min(1, state.flashTimer / 400);
  const scale = lerp(0.6, 1.0, easeOut(1 - state.flashTimer / 950));
  const isHR  = state.lastOutcome === 'hr';
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(LW/2, LH*0.36);
  ctx.scale(scale, scale);
  // Dark backing pill (taller when HR to fit distance)
  const tw  = state.flashMsg.length * 7.5;
  const ph  = isHR ? 46 : 26;
  $(~~(-tw*0.5 - 8), -16, ~~(tw+16), ph, 'rgba(0,0,0,0.70)');
  // Shadow text
  ctx.fillStyle = P.black;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(state.flashMsg, 2, 2);
  // Coloured text
  ctx.fillStyle = state.flashColor;
  ctx.fillText(state.flashMsg, 0, 0);
  // HR distance tag
  if(isHR && state.hrDistance > 0) {
    // distance banner beneath main text
    const distStr = `${state.hrDistance} FT`;
    ctx.font = 'bold 13px monospace';
    // gold bar
    const bw = distStr.length * 8 + 16;
    $(~~(-bw/2), 8, bw, 18, P.gold);
    ctx.fillStyle = P.navy;
    ctx.fillText(distStr, 0, 22);
  }
  ctx.restore();
}

// ─── Frame render ─────────────────────────────────────────────
function drawFrame(dt) {
  ctx.clearRect(0,0,LW,LH);

  drawSky();
  drawSun();
  drawBleachers();
  drawScoreboard();        // outfield scoreboard
  drawOutfieldWall();
  drawFoulPoles();
  drawWarningTrack();
  drawField();             // grass + foul lines
  drawInfield();           // dirt diamond, bases, mound
  drawBatterBox();
  drawHomePlate();
  drawStrikeZone(0.35);

  // Palm trees (beyond left & right field)
  drawPalm(22,  F.trackBot+8, 55);
  drawPalm(298, F.trackBot+5, 62);

  // Pitcher
  if(state.phase==='pitching'||state.phase==='idle') {
    drawPitcher(state.phase==='pitching' ? state.pitchT : 0);
  }

  // Live ball (during pitch) — grows and spins as it approaches
  if(state.phase==='pitching' && !state.swung) {
    const bx = lerp(BALL_START.x, BALL_END.x, state.pitchT);
    const by = lerp(BALL_START.y, BALL_END.y, state.pitchT)
              - Math.sin(state.pitchT*Math.PI)*18; // arc
    const bs = lerp(BALL_SIZE_S, BALL_SIZE_L, state.pitchT*state.pitchT);
    drawBall(bx, by, bs, state.ballSpin);
  }

  // Hit ball animation
  if(state.ballAnim) {
    drawTrajectoryArc();
    const {pts,t}=state.ballAnim;
    const idx=Math.min(pts.length-1, ~~(t*pts.length));
    const pt=pts[idx];
    drawBall(pt.x, pt.y, Math.max(3, pt.sz*(1-t*0.3)), state.ballSpin);
  }

  // Contact flash effect (brief sparkle when bat meets ball)
  drawContactFlash();

  drawConfetti(dt);

  // Batter foreground (always visible)
  drawBatter();

  // Big result popup (over field, below HUD)
  drawResultPopup();

  // HUD (drawn on top of everything)
  drawHUD();

  // Timing meter (only during pitch)
  if(state.phase==='pitching') drawTimingMeter(state.pitchT);

  drawScanlines();
}

// ─── Game logic ───────────────────────────────────────────────
function startGame() {
  resetState();
  showScreen('game');
  setTimeout(startPitch, 700);
}

function startPitch() {
  if(state.pitchesLeft<=0){ endGame(); return; }
  state.phase='pitching'; state.pitchT=0; state.swung=false;
  state.batSwing=0; state.batSwinging=false; state.ballAnim=null;
  state.ballSpin=0; state.contactFlash=0;
  sndPitch();
}

function doSwing() {
  if(state.phase!=='pitching'||state.swung) return;
  state.swung=true; state.batSwinging=true; state.batSwing=0;

  const t=state.pitchT;
  let outcome;
  if(t>=PERFECT_MIN && t<=PERFECT_MAX)    outcome='hr';
  else if(t>=GOOD_MIN && t<=GOOD_MAX)     outcome='deep';
  else if(t>0.14 && t<0.96)              outcome='ground';
  else                                     outcome='miss';

  applyOutcome(outcome);
}

function doAutoMiss() {
  if(state.swung) return;
  state.swung=true;
  applyOutcome('miss');
}

const FLASH_INFO = {
  hr:     { msg:'💥 CRUSHED!',        c: '#F8E040' },
  deep:   { msg:'⚡ DEEP HIT!',        c: '#70C0FF' },
  ground: { msg:'🏃 GROUNDER',         c: '#70E070' },
  miss:   { msg:'❌ SWING AND A MISS', c: '#C09090' },
};

function applyOutcome(outcome) {
  state.lastOutcome=outcome;
  state.hitLog.push(outcome);
  state.score+=SCORES[outcome];
  if(outcome==='hr') state.homeRuns++;
  state.pitchesLeft--;

  const fi=FLASH_INFO[outcome];
  state.flashMsg=fi.msg; state.flashColor=fi.c; state.flashTimer=950;

  if(outcome==='miss') sndMiss();
  else {
    sndCrack();
    // Contact flash at ball position
    state.contactFlash = 1;
    state.contactX = lerp(BALL_START.x, BALL_END.x, state.pitchT);
    state.contactY = lerp(BALL_START.y, BALL_END.y, state.pitchT)
                   - Math.sin(state.pitchT*Math.PI)*18;
    if(outcome==='hr'){
      // Distance: closer to perfect center → farther ball
      const pCenter = (PERFECT_MIN + PERFECT_MAX) / 2;
      const spread  = (PERFECT_MAX - PERFECT_MIN) / 2;
      const fromCtr = Math.abs(state.pitchT - pCenter) / spread; // 0=dead center, 1=edge
      state.hrDistance = Math.round(lerp(445, 385, fromCtr) + (Math.random()-0.5)*18);
      setTimeout(sndHR,200);
      setTimeout(()=>sndCrowdCheer(1.0), 300);
      spawnConfetti();
      state.crowdExcited = 1;   // crowd goes wild!
    } else if(outcome==='deep'){
      setTimeout(()=>sndCrowdCheer(0.5), 200);
      state.crowdExcited = 0.5;
    }
  }

  if(outcome!=='miss') buildTrajectory(outcome);

  state.phase='result';
  state.resultTimer = outcome==='hr' ? 2400 : 1500;
}

function endGame() {
  state.phase='end';
  showScreen('end');
  document.getElementById('finalScore').textContent=state.score;
  document.getElementById('finalHR').textContent=state.homeRuns;

  const pct=state.score/(TOTAL_PITCHES*SCORES.hr);
  const msgs=[
    [0.9,'🏆 LEGENDARY! Hall of Fame!'],
    [0.7,'🌟 AMAZING! Scouts are watching!'],
    [0.5,'⚡ SOLID GAME! Keep swinging!'],
    [0.25,'👍 More practice, champ!'],
    [0,  '😅 Keep your eye on the ball!'],
  ];
  document.getElementById('ratingMsg').textContent=msgs.find(([t])=>pct>=t)[1];

  const logEl=document.getElementById('hitLog');
  logEl.innerHTML='';
  state.hitLog.forEach(h=>{
    const chip=document.createElement('span');
    chip.className=`hit-chip ${h}`;
    chip.textContent={hr:'⚾ HR',deep:'💥 Deep',ground:'🏃 Gnd',miss:'❌'}[h];
    logEl.appendChild(chip);
  });
}

// ─── Main loop ────────────────────────────────────────────────
let lastTs=0;
function loop(ts) {
  const dt=Math.min((ts-(lastTs||ts)), 50);
  lastTs=ts;

  if(state.phase==='pitching') {
    state.pitchT=Math.min(0.97, state.pitchT+dt/PITCH_DURATION);
    // Ball spins faster as it approaches (backspin)
    state.ballSpin += dt * 0.008 * (1 + state.pitchT * 3);
    if(state.pitchT>=0.96 && !state.swung) doAutoMiss();
  }

  if(state.phase==='result') {
    state.resultTimer-=dt;
    if(state.batSwinging) {
      // Snappy start, smooth follow-through
      const speed = lerp(0.006, 0.0028, Math.min(1, state.batSwing));
      state.batSwing=Math.min(1, state.batSwing+speed*dt);
      if(state.batSwing>=1) state.batSwinging=false;
    }
    if(state.ballAnim) {
      state.ballAnim.t=Math.min(1, state.ballAnim.t+state.ballAnim.speed*(dt/16));
      // Ball spins during flight (topspin/backspin)
      state.ballSpin += dt * 0.018;
    }
    if(state.resultTimer<=0) {
      state.phase='idle'; state.ballAnim=null;
      if(state.pitchesLeft<=0) endGame();
      else setTimeout(startPitch, 350);
    }
  }

  state.flashTimer=Math.max(0, state.flashTimer-dt);
  state.crowdT+=dt;
  // Crowd excitement decays
  state.crowdExcited = Math.max(0, (state.crowdExcited||0) - dt*0.0008);
  // Contact flash decays fast
  state.contactFlash = Math.max(0, (state.contactFlash||0) - dt*0.005);

  drawFrame(dt);
  requestAnimationFrame(loop);
}

// ─── Events ───────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('playAgainBtn').addEventListener('click', startGame);
swingZ.addEventListener('click', doSwing);
swingZ.addEventListener('touchstart', e=>{ e.preventDefault(); doSwing(); }, {passive:false});

// ─── Init ─────────────────────────────────────────────────────
resetState();
showScreen('start');
requestAnimationFrame(loop);
