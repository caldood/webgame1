/* ============================================================
   SD Little League Home Run Derby — game.js
   Batter's-eye-view, 16-bit pixel art style
   ============================================================ */

'use strict';

// ─── Logical resolution (pixel-art canvas, scaled via CSS) ───
const LW = 240;   // logical width
const LH = 360;   // logical height

// Vanishing point (where pitcher stands / ball originates)
const VP = { x: 120, y: 98 };

// ─── Game constants ───────────────────────────────────────────
const TOTAL_PITCHES  = 10;
const PITCH_DURATION = 2200;   // ms — slightly slow so easier to react

// Timing zones as fractions of pitchT (0=release, 1=ball passes plate)
// Meter indicator = pitchT directly, so zones are visual guides
const PERFECT_MIN = 0.56;
const PERFECT_MAX = 0.76;
const GOOD_MIN    = 0.40;
const GOOD_MAX    = 0.90;

const SCORES = { hr: 10, deep: 5, ground: 1, miss: 0 };

// 16-bit color palette
const P = {
  sky0:    '#2038A8',   // top sky
  sky1:    '#3050C0',
  sky2:    '#4868D0',
  sky3:    '#6080D8',
  sky4:    '#88A8E8',
  bleach0: '#806040',   // bleachers
  bleach1: '#A07850',
  seatR:   '#C02828',
  seatB:   '#2840B8',
  seatY:   '#C89018',
  seatG:   '#208020',
  wall:    '#186018',
  wallTop: '#20A020',
  grass0:  '#187018',   // dark grass stripe
  grass1:  '#28A028',   // light grass stripe
  infield: '#986830',   // dirt
  infieldD:'#785020',
  chalk:   '#F8F8F0',
  blue:    '#0830B8',
  ltBlue:  '#3060E0',
  gold:    '#F8C020',
  white:   '#F8F8F8',
  black:   '#080808',
  red:     '#D02020',
  green:   '#20C020',
  skin:    '#F0C898',
  hudBg:   '#080820',
  hitGold: '#F8E040',
  hitBlue: '#60A0F8',
  hitGreen:'#60E060',
  hitGray: '#808080',
};

// ─── State ────────────────────────────────────────────────────
let state = {};

function resetState() {
  state = {
    phase: 'idle',       // idle | pitching | result | end
    score: 0,
    pitchesLeft: TOTAL_PITCHES,
    homeRuns: 0,
    hitLog: [],
    pitchT: 0,           // 0..1 pitch progress
    swung: false,
    lastOutcome: null,
    resultTimer: 0,
    batSwing: 0,         // 0..1 swing animation
    batSwinging: false,
    ballAnim: null,      // { pts[], t, speed }
    confetti: [],
    flashMsg: '',
    flashColor: P.gold,
    flashTimer: 0,
    crowdWave: 0,        // time accumulator for crowd anim
    readyTimer: 0,       // countdown before next pitch
  };
}

// ─── DOM ──────────────────────────────────────────────────────
const canvas       = document.getElementById('gameCanvas');
const ctx          = canvas.getContext('2d');
const scoreDisplay = document.getElementById('scoreDisplay');
const pitchDisplay = document.getElementById('pitchesDisplay');
const swingZone    = document.getElementById('swingZone');

const screens = {
  start: document.getElementById('startScreen'),
  game:  document.getElementById('gameScreen'),
  end:   document.getElementById('endScreen'),
};

// ─── Canvas setup (pixel art: fixed logical size, CSS scales) ─
canvas.width  = LW;
canvas.height = LH;
ctx.imageSmoothingEnabled = false;

// ─── Audio ────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  return audioCtx;
}
function tone(freq, type, dur, vol, delay) {
  const ac = getAudio(); if (!ac) return;
  const t0 = ac.currentTime + (delay || 0);
  const osc = ac.createOscillator();
  const g   = ac.createGain();
  osc.connect(g); g.connect(ac.destination);
  osc.type = type || 'square';
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(vol || 0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}
function sndCrack()    { tone(300,'sawtooth',0.05,0.5); tone(600,'square',0.04,0.3,0.02); tone(1200,'sine',0.06,0.2,0.01); }
function sndMiss()     { tone(160,'sine',0.25,0.15); tone(110,'sine',0.3,0.1,0.12); }
function sndHR()       { [523,659,784,880,1047].forEach((f,i) => tone(f,'square',0.18,0.28,i*0.11)); }
function sndPitch()    { tone(220,'sine',0.06,0.12); }
function sndReady()    { tone(440,'square',0.08,0.1); }

// ─── Screen helpers ───────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));
}

// ─── Pixel drawing helpers ────────────────────────────────────

/** Draw a filled rectangle at integer pixel coords */
function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
}

/** Outline rect */
function pxOutline(x, y, w, h, color, thick) {
  const t = thick || 1;
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), t);          // top
  ctx.fillRect(Math.floor(x), Math.floor(y+h-t), Math.ceil(w), t);      // bottom
  ctx.fillRect(Math.floor(x), Math.floor(y), t, Math.ceil(h));           // left
  ctx.fillRect(Math.floor(x+w-t), Math.floor(y), t, Math.ceil(h));       // right
}

/** Draw pixel text using simple 5x7-ish bitmap font via canvas text (monospace) */
function pxText(text, x, y, color, size) {
  ctx.fillStyle = color;
  ctx.font = `${size||8}px monospace`;
  ctx.textAlign = 'left';
  ctx.fillText(text, Math.floor(x), Math.floor(y));
}
function pxTextC(text, x, y, color, size) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size||8}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(text, Math.floor(x), Math.floor(y));
}

// ─── Scene drawing (batter's-eye perspective) ─────────────────

function drawSky() {
  const bands = [P.sky0, P.sky0, P.sky1, P.sky2, P.sky2, P.sky3, P.sky4, P.sky4];
  const h     = VP.y + 30; // sky height
  bands.forEach((c, i) => px(0, i * (h / bands.length), LW, (h / bands.length) + 1, c));
}

function drawBleachers() {
  // Back wall of bleachers
  const by = VP.y - 32, bh = 36;
  px(14, by, LW - 28, bh, P.bleach0);
  px(14, by, LW - 28, 4, P.bleach1); // highlight top edge

  // Seat rows
  const seats = 3, cols = 18;
  const seatColors = [P.seatR, P.seatB, P.seatY, P.seatG, P.seatR, P.seatB];
  for (let r = 0; r < seats; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = 18 + c * ((LW - 36) / cols);
      const sy = by + 6 + r * 9;
      px(sx, sy, (LW - 36) / cols - 1, 7, seatColors[(r * 3 + c) % seatColors.length]);
    }
  }

  // Crowd heads (bobbing with time)
  for (let i = 0; i < 22; i++) {
    const hx = 16 + i * 9.5;
    const bob = Math.sin(state.crowdWave * 0.003 + i * 0.9) > 0.7 ? -2 : 0;
    const hy  = by + 2 + bob;
    const skinTones = [P.skin, '#E0A070', '#C07840', '#804020', '#F8D0B0'];
    px(hx, hy, 6, 6, skinTones[i % skinTones.length]);
    // hat
    const hatC = [P.blue, P.red, P.seatY][i % 3];
    px(hx - 1, hy - 3, 8, 3, hatC);
  }
}

function drawOutfieldWall() {
  const wy = VP.y + 2;
  // Main wall
  px(6, wy, LW - 12, 12, P.wall);
  px(6, wy, LW - 12, 2, P.wallTop);

  // HR sign
  px(LW/2 - 24, wy + 1, 48, 9, P.red);
  pxTextC('HOME RUN DERBY', LW/2, wy + 9, P.gold, 5);
  pxOutline(LW/2 - 24, wy + 1, 48, 9, P.gold, 1);

  // Fence posts
  for (let f = 10; f < LW - 10; f += 10) {
    px(f, wy, 1, 12, P.infieldD);
  }
}

function drawField() {
  // Perspective trapezoid grass
  // Near edge spans full width at bottom; far edge is around the outfield wall
  const farY = VP.y + 14, farL = VP.x - 8, farR = VP.x + 8;
  const nearY = LH, nearL = 0, nearR = LW;

  // Draw grass stripes for mowing effect
  const stripes = 10;
  for (let s = 0; s < stripes; s++) {
    const t0 = s / stripes, t1 = (s + 1) / stripes;
    const x0L = farL + (nearL - farL) * t0, x0R = farR + (nearR - farR) * t0;
    const x1L = farL + (nearL - farL) * t1, x1R = farR + (nearR - farR) * t1;
    const y0  = farY + (nearY - farY) * t0;
    const y1  = farY + (nearY - farY) * t1;
    const col = s % 2 === 0 ? P.grass0 : P.grass1;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(Math.floor(x0L), Math.floor(y0));
    ctx.lineTo(Math.floor(x0R), Math.floor(y0));
    ctx.lineTo(Math.floor(x1R), Math.floor(y1));
    ctx.lineTo(Math.floor(x1L), Math.floor(y1));
    ctx.closePath();
    ctx.fill();
  }

  // Foul lines: from home plate center to outfield corners
  ctx.strokeStyle = P.chalk;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(LW / 2, LH);
  ctx.lineTo(farL - 4, farY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(LW / 2, LH);
  ctx.lineTo(farR + 4, farY);
  ctx.stroke();

  drawInfield();
}

function drawInfield() {
  // Infield dirt: perspective ellipse
  ctx.fillStyle = P.infield;
  ctx.beginPath();
  ctx.ellipse(LW / 2, LH * 0.72, 60, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.infieldD;
  ctx.beginPath();
  ctx.ellipse(LW / 2, LH * 0.72, 58, 20, 0, 0, Math.PI);
  ctx.fill();

  // Pitcher's mound
  ctx.fillStyle = P.infieldD;
  ctx.beginPath();
  ctx.ellipse(VP.x, VP.y + 50, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base paths (simplified chalk lines)
  ctx.strokeStyle = P.chalk;
  ctx.lineWidth = 1;

  // First base path (to the right)
  const fpX = LW / 2 + 40, fpY = LH * 0.56;
  ctx.beginPath(); ctx.moveTo(LW/2, LH * 0.92); ctx.lineTo(fpX, fpY); ctx.stroke();
  px(fpX - 4, fpY - 4, 8, 8, P.white);  // 1st base

  // Third base path (to the left)
  const tpX = LW / 2 - 40, tpY = LH * 0.56;
  ctx.beginPath(); ctx.moveTo(LW/2, LH * 0.92); ctx.lineTo(tpX, tpY); ctx.stroke();
  px(tpX - 4, tpY - 4, 8, 8, P.white);  // 3rd base

  // Second base (in the distance)
  px(VP.x - 5, VP.y + 36, 10, 10, P.white);

  // Home plate (foreground)
  drawHomePlate();
}

function drawHomePlate() {
  // Pentagonal home plate at bottom center
  const px2 = LW / 2, py2 = LH - 18;
  ctx.fillStyle = P.white;
  ctx.beginPath();
  ctx.moveTo(px2, py2 - 6);
  ctx.lineTo(px2 + 10, py2);
  ctx.lineTo(px2 + 10, py2 + 8);
  ctx.lineTo(px2 - 10, py2 + 8);
  ctx.lineTo(px2 - 10, py2);
  ctx.closePath();
  ctx.fill();
}

// ─── Strike zone box ──────────────────────────────────────────
function drawStrikeZone(alpha) {
  // Visible box showing the strike zone to help the player aim
  const szX = LW/2 - 14, szY = LH * 0.44, szW = 28, szH = 32;
  ctx.globalAlpha = alpha || 0.35;
  pxOutline(szX, szY, szW, szH, P.chalk, 1);
  ctx.globalAlpha = 1;
}

// ─── Pitcher sprite (16-bit pixel art) ───────────────────────
function drawPitcher(t) {
  // Pitcher shrinks in distance; t goes 0→1 during pitch
  const scale = Math.max(0.1, 1 - t * 0.3);
  const cx = VP.x, cy = VP.y + 16;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Legs
  px(-3, 14, 4, 12, P.white);  // left leg
  px(2,  14, 4, 12, P.white);  // right leg
  px(-3, 24, 4, 2,  P.blue);   // stirrups
  px(2,  24, 4, 2,  P.blue);

  // Body (jersey)
  px(-7, 0, 14, 16, P.blue);
  // white pinstripes
  px(-3, 0, 2, 16, P.white);
  px(2,  0, 2, 16, P.white);
  // number
  pxTextC('12', 0, 12, P.white, 6);

  // Head
  px(-5, -14, 10, 10, P.skin);

  // Cap
  px(-6, -16, 12, 6, P.blue);  // crown
  px(-6, -12, 14, 2, P.blue);  // brim

  // Arm — wind-up based on pitch progress
  const armY  = t < 0.2 ? -6 - t * 30 : -6 + (t - 0.2) * 20;
  const armX2 = t < 0.2 ? 10 + t * 5 : 14 - (t - 0.2) * 12;
  ctx.strokeStyle = P.skin;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(7, 2);
  ctx.lineTo(armX2, armY);
  ctx.stroke();

  // Ball in hand (disappears after release at t>0.12)
  if (t < 0.12) {
    px(armX2, armY - 3, 5, 5, P.white);
  }

  ctx.restore();
}

// ─── Batter arms + bat (foreground, lower-right corner) ───────
function drawBat() {
  // Bat appears at lower right, swings when state.batSwinging
  const bx = LW - 28, by = LH - 56;
  const swingA = state.batSwinging
    ? -1.2 + state.batSwing * 2.4
    : 0.2; // resting angle

  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(swingA);

  // Arms
  px(-6, 0, 10, 22, P.skin);  // forearms

  // Bat handle
  ctx.fillStyle = '#5D4037';
  ctx.lineWidth = 4; ctx.strokeStyle = '#5D4037'; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(0, -40);
  ctx.stroke();

  // Barrel
  px(-5, -52, 10, 18, '#8D6E63');
  px(-4, -52, 8, 2, '#BCAAA4');  // highlight

  // Gloves
  px(-8, 2, 12, 8, P.blue);

  ctx.restore();
}

// ─── Baseball ball ────────────────────────────────────────────
function drawBall(x, y, size) {
  const r = Math.max(1, Math.floor(size / 2));
  const ix = Math.floor(x - r), iy = Math.floor(y - r), id = r * 2;
  // Shadow
  px(ix + 2, iy + 2, id, id, 'rgba(0,0,0,0.25)');
  // Ball body
  px(ix, iy, id, id, P.white);
  // Simple seam lines
  ctx.fillStyle = '#E07070';
  if (r >= 4) {
    // left seam arc (2px)
    for (let i = 0; i < 5; i++) {
      const sx = ix + 1 + i, sy = iy + r + Math.round(Math.sin((i/5)*Math.PI)*r*0.5);
      px(sx, sy, 1, 2, '#E07070');
    }
    for (let i = 0; i < 5; i++) {
      const sx = ix + r + 1 + i, sy = iy + r - Math.round(Math.sin((i/5)*Math.PI)*r*0.5);
      px(sx, sy, 1, 2, '#E07070');
    }
  }
  // Highlight pixel
  px(ix + Math.max(1, Math.floor(r*0.3)), iy + Math.max(1, Math.floor(r*0.3)), Math.max(1,Math.floor(r*0.3)), Math.max(1,Math.floor(r*0.3)), '#FFFFFF');
}

// ─── Trajectory arc after hit ─────────────────────────────────
function buildTrajectory(outcome) {
  const steps = 30;
  const pts = [];
  const sx = LW / 2, sy = ballYForT(0.65);
  let ex, peakUp;
  switch (outcome) {
    case 'hr':    ex = LW/2 + (Math.random()-0.5)*60; peakUp = LH * 0.6; break;
    case 'deep':  ex = LW/2 + (Math.random()-0.5)*80; peakUp = LH * 0.45; break;
    default:      ex = LW/2 + (Math.random()-0.5)*60; peakUp = LH * 0.3; break;
  }
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const bx = sx + (ex - sx) * f;
    const by = sy - 4 * peakUp * f * (1 - f);
    pts.push({ x: bx, y: by, sz: 6 + (1-f)*8 });
  }
  state.ballAnim = { pts, t: 0, speed: outcome === 'hr' ? 0.022 : 0.028 };
}

function drawTrajectoryArc() {
  if (!state.ballAnim) return;
  const { pts, t } = state.ballAnim;
  const end = Math.floor(t * pts.length);
  ctx.fillStyle = 'rgba(255,255,200,0.5)';
  for (let i = 0; i < end; i += 2) {
    px(pts[i].x - 1, pts[i].y - 1, 2, 2, 'rgba(255,255,200,0.4)');
  }
}

// ─── HUD ─────────────────────────────────────────────────────
function drawHUD() {
  // Top bar
  px(0, 0, LW, 20, P.hudBg);
  pxOutline(0, 0, LW, 20, P.gold, 1);

  // Score
  pxText('SCR', 4, 9, P.gold, 7);
  pxText(String(state.score).padStart(3,'0'), 4, 18, P.white, 8);

  // Pitches
  const pitchStr = `PITCHES:${state.pitchesLeft}`;
  ctx.font = 'bold 7px monospace';
  ctx.fillStyle = P.white;
  ctx.textAlign = 'center';
  ctx.fillText(pitchStr, LW/2, 13);

  // HR count
  pxText(`HR:${state.homeRuns}`, LW - 36, 9, P.gold, 7);

  // Balls on scoreboard
  const dotX = LW - 30;
  pxText(`${state.homeRuns}HR`, LW - 32, 18, P.hitGold, 8);
}

// ─── Timing meter ────────────────────────────────────────────
function drawTimingMeter(t) {
  // Drawn on canvas, bottom of screen
  const mx = 6, my = LH - 38, mw = LW - 12, mh = 14;

  // Background
  px(mx, my, mw, mh, '#200820');
  pxOutline(mx, my, mw, mh, P.gold, 1);

  // Zones (colored bands inside meter)
  // Miss zone (left + right): red
  px(mx+1, my+1, mw-2, mh-2, P.red);

  // Good zones: green
  const gL = Math.floor((GOOD_MIN) * (mw - 2));
  const gR = Math.floor((GOOD_MAX) * (mw - 2));
  px(mx+1+gL, my+1, gR - gL, mh-2, P.green);

  // Perfect zone: gold
  const pL = Math.floor(PERFECT_MIN * (mw - 2));
  const pR = Math.floor(PERFECT_MAX * (mw - 2));
  px(mx+1+pL, my+1, pR - pL, mh-2, P.gold);

  // Zone labels
  pxTextC('GOOD', mx+1+gL + (pL-gL)/2, my+mh-3, P.black, 5);
  pxTextC('PERFECT', mx+1+pL + (pR-pL)/2, my+mh-3, P.black, 5);
  pxTextC('GOOD', mx+1+pR + (gR-pR)/2, my+mh-3, P.black, 5);

  // Indicator — position tied directly to pitchT
  const indX = Math.floor(mx + 1 + t * (mw - 4));
  px(indX - 2, my, 5, mh, P.white);
  px(indX - 1, my + 1, 3, mh - 2, '#80C0FF');

  // Label above meter
  pxTextC('TIMING — TAP TO SWING!', LW/2, my - 3, P.white, 5);
}

// ─── Flash message ────────────────────────────────────────────
function drawFlash() {
  if (state.flashTimer <= 0) return;
  const alpha = Math.min(1, state.flashTimer / 300);
  ctx.globalAlpha = alpha;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = P.black;
  ctx.fillText(state.flashMsg, LW/2+2, LH/2 - 28);
  ctx.fillStyle = state.flashColor;
  ctx.fillText(state.flashMsg, LW/2, LH/2 - 30);
  ctx.globalAlpha = 1;
}

// ─── Confetti ────────────────────────────────────────────────
function spawnConfetti() {
  state.confetti = [];
  for (let i = 0; i < 40; i++) {
    state.confetti.push({
      x: Math.random() * LW, y: 20,
      vx: (Math.random()-0.5)*3, vy: 1 + Math.random()*2,
      color: [P.gold, P.red, P.blue, P.white, P.green][Math.floor(Math.random()*5)],
      w: 3 + Math.floor(Math.random()*3),
      h: 2 + Math.floor(Math.random()*2),
      life: 1.0,
    });
  }
}

function updateDrawConfetti(dt) {
  state.confetti = state.confetti.filter(c => c.life > 0);
  state.confetti.forEach(c => {
    c.x += c.vx; c.y += c.vy; c.vy += 0.04;
    c.life -= 0.006;
    ctx.globalAlpha = c.life;
    px(c.x, c.y, c.w, c.h, c.color);
  });
  ctx.globalAlpha = 1;
}

// ─── Scanlines overlay (CRT effect) ──────────────────────────
function drawScanlines() {
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let sy = 0; sy < LH; sy += 2) ctx.fillRect(0, sy, LW, 1);
}

// ─── Ball position calculation ────────────────────────────────
function ballXForT(t) {
  // Slight curve to the left (like a fastball), mostly straight
  return VP.x + Math.sin(t * Math.PI) * 3;
}

function ballYForT(t) {
  // Starts above VP (pitcher's release), arcs toward strike zone
  const startY = VP.y + 22;
  const endY   = LH * 0.60;     // arrives at hitting zone
  const arc    = -12 * t * (1 - t); // slight parabola (ball rises then drops)
  return startY + (endY - startY) * t + arc;
}

function ballSizeForT(t) {
  return 2 + t * 20;
}

// ─── Main draw ────────────────────────────────────────────────
function drawFrame(dt) {
  // Scene
  drawSky();
  drawBleachers();
  drawOutfieldWall();
  drawField();
  drawStrikeZone(0.4);

  // Pitcher
  if (state.phase === 'pitching' || state.phase === 'idle') {
    drawPitcher(state.phase === 'pitching' ? state.pitchT : 0);
  }

  // Ball
  if (state.phase === 'pitching' && !state.swung) {
    const bx = ballXForT(state.pitchT);
    const by = ballYForT(state.pitchT);
    const bs = ballSizeForT(state.pitchT);
    drawBall(bx, by, bs);
  }

  // Hit ball animation
  if (state.phase === 'result' && state.ballAnim) {
    drawTrajectoryArc();
    const { pts, t } = state.ballAnim;
    const idx = Math.min(pts.length - 1, Math.floor(t * pts.length));
    const pt  = pts[idx];
    drawBall(pt.x, pt.y, Math.max(3, pt.sz * (1 - t * 0.4)));
  }

  // Confetti
  updateDrawConfetti(dt);

  // Bat foreground
  drawBat();

  // HUD
  drawHUD();

  // Timing meter (only during pitch)
  if (state.phase === 'pitching') {
    drawTimingMeter(state.pitchT);
  }

  // Flash message
  drawFlash();

  // Scanlines for CRT effect
  drawScanlines();
}

// ─── Game logic ───────────────────────────────────────────────

function startGame() {
  resetState();
  updateDOMHUD();
  showScreen('game');
  setTimeout(startPitch, 700);
}

function startPitch() {
  if (state.pitchesLeft <= 0) { endGame(); return; }
  state.phase   = 'pitching';
  state.pitchT  = 0;
  state.swung   = false;
  state.batSwing = 0;
  state.batSwinging = false;
  state.ballAnim = null;
  state.confetti = [];
  sndPitch();
}

function doSwing() {
  if (state.phase !== 'pitching' || state.swung) return;
  state.swung     = true;
  state.batSwinging = true;
  state.batSwing    = 0;

  const t = state.pitchT;
  let outcome;
  if (t >= PERFECT_MIN && t <= PERFECT_MAX) outcome = 'hr';
  else if (t >= GOOD_MIN && t <= GOOD_MAX)  outcome = 'deep';
  else if (t > 0.15 && t < 0.95)            outcome = 'ground';
  else                                       outcome = 'miss';

  applyOutcome(outcome);
}

function doAutoMiss() {
  if (state.swung) return;
  state.swung = true;
  applyOutcome('miss');
}

function applyOutcome(outcome) {
  state.lastOutcome = outcome;
  state.hitLog.push(outcome);
  state.score += SCORES[outcome];
  if (outcome === 'hr') state.homeRuns++;
  state.pitchesLeft--;

  const LABELS = {
    hr:     { text: 'CRUSHED!',       color: P.hitGold  },
    deep:   { text: 'DEEP HIT!',      color: P.hitBlue  },
    ground: { text: 'GROUNDER!',      color: P.hitGreen },
    miss:   { text: 'SWING AND MISS', color: P.hitGray  },
  };
  const info = LABELS[outcome];
  state.flashMsg   = info.text;
  state.flashColor = info.color;
  state.flashTimer = 900;

  if (outcome === 'miss') sndMiss();
  else { sndCrack(); if (outcome === 'hr') { setTimeout(sndHR, 200); spawnConfetti(); } }

  if (outcome !== 'miss') buildTrajectory(outcome);

  state.phase       = 'result';
  state.resultTimer = outcome === 'hr' ? 2400 : 1400;
  updateDOMHUD();
}

function updateDOMHUD() {
  scoreDisplay.textContent = state.score;
  pitchDisplay.textContent = state.pitchesLeft;
}

function endGame() {
  state.phase = 'end';
  showScreen('end');

  document.getElementById('finalScore').textContent = state.score;
  document.getElementById('finalHR').textContent    = state.homeRuns;

  const pct = state.score / (TOTAL_PITCHES * SCORES.hr);
  let msg;
  if (pct >= 0.9)      msg = '🏆 LEGENDARY! Hall of Fame!';
  else if (pct >= 0.7) msg = '🌟 AMAZING SLUGGER!';
  else if (pct >= 0.5) msg = '⚡ SOLID GAME!';
  else if (pct >= 0.25)msg = '👍 Keep practicing, champ!';
  else                 msg = '😅 Eyes on the ball!';
  document.getElementById('ratingMsg').textContent = msg;

  const logEl = document.getElementById('hitLog');
  logEl.innerHTML = '';
  state.hitLog.forEach(h => {
    const chip = document.createElement('span');
    chip.className = `hit-chip ${h}`;
    chip.textContent = h === 'hr' ? '⚾HR' : h === 'deep' ? '💥Deep' : h === 'ground' ? '🏃Gnd' : '❌';
    logEl.appendChild(chip);
  });
}

// ─── Main loop ────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min(ts - (lastTime || ts), 50);
  lastTime = ts;

  // Phase updates
  if (state.phase === 'pitching') {
    state.pitchT = Math.min(0.98, state.pitchT + dt / PITCH_DURATION);
    // Auto-miss if player doesn't swing in time
    if (state.pitchT >= 0.96 && !state.swung) doAutoMiss();
  }

  if (state.phase === 'result') {
    state.resultTimer -= dt;
    if (state.batSwinging) {
      state.batSwing = Math.min(1, state.batSwing + dt * 0.004);
      if (state.batSwing >= 1) state.batSwinging = false;
    }
    if (state.ballAnim) {
      state.ballAnim.t = Math.min(1, state.ballAnim.t + state.ballAnim.speed * (dt / 16));
    }
    if (state.resultTimer <= 0) {
      state.phase = 'idle';
      state.ballAnim = null;
      if (state.pitchesLeft <= 0) endGame();
      else setTimeout(startPitch, 350);
    }
  }

  state.flashTimer   = Math.max(0, state.flashTimer - dt);
  state.crowdWave   += dt;

  // Draw
  drawFrame(dt);

  requestAnimationFrame(loop);
}

// ─── Events ───────────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('playAgainBtn').addEventListener('click', startGame);

swingZone.addEventListener('click', () => doSwing());
swingZone.addEventListener('touchstart', e => { e.preventDefault(); doSwing(); }, { passive: false });

// ─── Init ─────────────────────────────────────────────────────
resetState();
showScreen('start');
requestAnimationFrame(loop);
