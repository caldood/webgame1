/* ============================================================
   SD Little League Home Run Derby — game.js
   Pure HTML5 Canvas + JS, no dependencies
   ============================================================ */

'use strict';

// ─── Constants ───────────────────────────────────────────────
const TOTAL_PITCHES  = 10;
const PITCH_DURATION = 1800;  // ms ball travels to plate
const METER_SPEED    = 0.018; // how fast indicator sweeps (0-1 per ms, ~1.8s full sweep)

// Timing thresholds (0 = early, 0.5 = perfect, 1 = late)
const PERFECT_MIN = 0.40;
const PERFECT_MAX = 0.60;
const GOOD_MIN    = 0.25;
const GOOD_MAX    = 0.75;

// Score per outcome
const SCORES = { hr: 10, deep: 5, ground: 1, miss: 0 };

// Dodger palette
const C = {
  sky1:    '#87CEEB',
  sky2:    '#C9E8F7',
  ocean:   '#1565C0',
  grass1:  '#2E7D32',
  grass2:  '#43A047',
  sand:    '#D4A857',
  chalk:   'rgba(255,255,255,0.85)',
  blue:    '#005A9C',
  white:   '#FFFFFF',
  gold:    '#FFD700',
  crowd:   'rgba(180,130,90,0.55)',
};

// ─── State ────────────────────────────────────────────────────
let state = {
  phase: 'start',   // start | idle | pitching | result | end
  score: 0,
  pitchesLeft: TOTAL_PITCHES,
  homeRuns: 0,
  hitLog: [],       // array of outcome strings
  meterPos: 0,      // 0..1
  meterDir: 1,
  pitchT: 0,        // 0..1 progress of ball
  swung: false,
  lastOutcome: null,
  ball: { x: 0, y: 0, vx: 0, vy: 0, visible: false },
  batAngle: 0,      // radians, for swing anim
  batSwinging: false,
  resultTimer: 0,
  feedbackEl: null,
  trajectoryPts: [], // [{x,y}] for arc
  crowdParts: [],    // crowd particle emitter data
  confetti: [],
};

// ─── DOM refs ─────────────────────────────────────────────────
const canvas       = document.getElementById('gameCanvas');
const ctx          = canvas.getContext('2d');
const scoreDisplay = document.getElementById('scoreDisplay');
const pitchDisplay = document.getElementById('pitchesDisplay');
const pitchResult  = document.getElementById('pitchResult');
const timingMeter  = document.getElementById('timingMeter');
const meterInd     = document.getElementById('meterIndicator');
const swingZone    = document.getElementById('swingZone');

const screens = {
  start: document.getElementById('startScreen'),
  game:  document.getElementById('gameScreen'),
  end:   document.getElementById('endScreen'),
};

// ─── Audio (Web Audio API, tiny synth sounds) ─────────────────
let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  return audioCtx;
}

function playTone(freq, type, dur, vol, startDelay) {
  const ac = getAudio();
  if (!ac) return;
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, ac.currentTime + (startDelay||0));
  gain.gain.setValueAtTime(vol||0.2, ac.currentTime + (startDelay||0));
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (startDelay||0) + dur);
  osc.start(ac.currentTime + (startDelay||0));
  osc.stop(ac.currentTime + (startDelay||0) + dur + 0.05);
}

function soundCrack() {
  // bat crack: short burst of noise
  playTone(220, 'sawtooth', 0.06, 0.4);
  playTone(440, 'square', 0.04, 0.3, 0.02);
  playTone(880, 'sine', 0.08, 0.2, 0.01);
}

function soundMiss() {
  playTone(180, 'sine', 0.2, 0.15);
  playTone(120, 'sine', 0.3, 0.1, 0.1);
}

function soundHomeRun() {
  // ascending fanfare
  [523, 659, 784, 1047].forEach((f, i) => playTone(f, 'square', 0.15, 0.25, i * 0.12));
}

function soundPitch() {
  playTone(200, 'sine', 0.08, 0.1);
}

// ─── Screen management ────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('active', k === name);
  });
}

// ─── Canvas sizing ────────────────────────────────────────────
function resizeCanvas() {
  const maxW = Math.min(window.innerWidth, 500);
  canvas.width  = maxW;
  canvas.height = window.innerHeight;
}

// ─── Drawing helpers ──────────────────────────────────────────

/** Draw a filled rounded rect */
function roundRect(x, y, w, h, r, fill, stroke, sw) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill)  { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke){ ctx.strokeStyle = stroke; ctx.lineWidth = sw||2; ctx.stroke(); }
}

/** Draw palm tree at (x, baseY) with height h */
function drawPalm(x, baseY, h) {
  const trunk = h * 0.7;
  // trunk
  ctx.save();
  ctx.strokeStyle = '#795548';
  ctx.lineWidth = h * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  // slight curve
  ctx.bezierCurveTo(x + h*0.05, baseY - trunk*0.5, x - h*0.04, baseY - trunk*0.8, x, baseY - trunk);
  ctx.stroke();

  // fronds
  const frondTip = baseY - trunk;
  const frondColors = ['#2E7D32','#388E3C','#43A047','#1B5E20'];
  const fronds = [
    [frondTip, frondTip - h*0.25, frondTip + h*0.28, frondTip - h*0.05],
    [frondTip, frondTip - h*0.22, frondTip - h*0.30, frondTip - h*0.08],
    [frondTip, frondTip - h*0.30, frondTip + h*0.08, frondTip - h*0.28],
    [frondTip, frondTip - h*0.28, frondTip - h*0.10, frondTip - h*0.30],
    [frondTip, frondTip - h*0.20, frondTip + h*0.14, frondTip - h*0.18],
  ];
  // Instead store as angle-based fronds
  const angles = [0, 40, -40, 70, -70, 110, -110, 150, -150, 180];
  angles.forEach((angleDeg, i) => {
    const rad = (angleDeg * Math.PI) / 180;
    const len = h * 0.32;
    const ex = frondTip + Math.cos(rad - Math.PI/2) * len * 1.6;
    const ey = frondTip + Math.sin(rad - Math.PI/2) * len;
    const mx = frondTip + Math.cos(rad - Math.PI/2) * len * 0.8 + Math.cos(rad) * len * 0.3;
    const my = frondTip + Math.sin(rad - Math.PI/2) * len * 0.5 + Math.sin(rad) * len * 0.3;
    ctx.fillStyle = frondColors[i % frondColors.length];
    ctx.beginPath();
    ctx.moveTo(x, frondTip);
    ctx.quadraticCurveTo(mx, my, ex, ey + len * 0.2);
    ctx.quadraticCurveTo(mx, my + 8, x, frondTip);
    ctx.closePath();
    ctx.fill();
  });
  ctx.restore();
}

/** Draw the ballpark scene on canvas */
function drawScene() {
  const W = canvas.width;
  const H = canvas.height;

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  skyGrad.addColorStop(0, '#5DADE2');
  skyGrad.addColorStop(1, '#D6EAF8');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Ocean strip behind outfield fence
  const oceanY = H * 0.32;
  const oceanGrad = ctx.createLinearGradient(0, oceanY, 0, oceanY + H * 0.09);
  oceanGrad.addColorStop(0, '#1565C0');
  oceanGrad.addColorStop(1, '#1E88E5');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, oceanY, W, H * 0.09);

  // Ocean sparkles
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  for (let i = 0; i < 12; i++) {
    const sx = (i / 12) * W + Math.sin(Date.now() * 0.001 + i) * 6;
    const sy = oceanY + H * 0.02 + Math.sin(Date.now() * 0.002 + i * 1.3) * 4;
    ctx.fillRect(sx, sy, 18, 3);
  }

  // Outfield fence
  const fenceY = H * 0.40;
  ctx.fillStyle = '#1B5E20';
  ctx.fillRect(0, fenceY - 8, W, 12);
  // fence boards
  ctx.strokeStyle = '#388E3C';
  ctx.lineWidth = 1.5;
  for (let fx = 0; fx < W; fx += 18) {
    ctx.beginPath();
    ctx.moveTo(fx, fenceY - 8);
    ctx.lineTo(fx, fenceY + 4);
    ctx.stroke();
  }
  // Home Run sign on fence
  roundRect(W*0.5 - 55, fenceY - 26, 110, 22, 4, '#E53935', C.gold, 2);
  ctx.fillStyle = C.gold;
  ctx.font = 'bold 11px Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOME RUN DERBY', W/2, fenceY - 11);

  // Crowd behind fence
  const crowdY = H * 0.41;
  for (let i = 0; i < 30; i++) {
    const cx = (i / 30) * W + 10;
    const cy = crowdY + Math.sin(i * 2.3) * 6;
    const cr = 7 + Math.sin(i * 1.7) * 2;
    // head
    ctx.fillStyle = ['#FFCDD2','#F8BBD0','#FFCCBC','#D7CCC8','#FFF9C4'][i % 5];
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
    // jersey
    const jerseyColors = [C.blue,'#C62828','#1565C0','#2E7D32','#F57F17'];
    ctx.fillStyle = jerseyColors[i % jerseyColors.length];
    ctx.fillRect(cx - cr, cy + cr * 0.8, cr * 2, cr * 1.5);
  }

  // Palm trees
  const palmData = [
    { x: W * 0.07,  y: H * 0.55, h: 90 },
    { x: W * 0.93,  y: H * 0.52, h: 100 },
    { x: W * 0.15,  y: H * 0.57, h: 70 },
    { x: W * 0.84,  y: H * 0.56, h: 80 },
  ];
  palmData.forEach(p => drawPalm(p.x, p.y, p.h));

  // Grass (outfield then infield)
  const grassGrad = ctx.createLinearGradient(0, H*0.45, 0, H);
  grassGrad.addColorStop(0, '#388E3C');
  grassGrad.addColorStop(0.3, '#43A047');
  grassGrad.addColorStop(1, '#2E7D32');
  ctx.fillStyle = grassGrad;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.45);
  ctx.lineTo(W, H * 0.45);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Mowing stripes
  ctx.globalAlpha = 0.15;
  for (let stripe = 0; stripe < 8; stripe++) {
    const sy2 = H * 0.45 + (stripe / 8) * (H * 0.55);
    if (stripe % 2 === 0) {
      ctx.fillStyle = '#1B5E20';
      ctx.fillRect(0, sy2, W, (H * 0.55) / 8);
    }
  }
  ctx.globalAlpha = 1;

  // Infield dirt
  const dirtCx = W / 2;
  const dirtCy = H * 0.82;
  ctx.fillStyle = C.sand;
  ctx.beginPath();
  ctx.ellipse(dirtCx, dirtCy, W * 0.45, H * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Base paths / chalk lines
  drawDiamondChalk(W, H);

  // Pitcher's mound
  const moundX = W * 0.5;
  const moundY = H * 0.65;
  ctx.fillStyle = '#C19A6B';
  ctx.beginPath();
  ctx.ellipse(moundX, moundY, 24, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Home plate
  const plateX = W * 0.5;
  const plateY = H * 0.88;
  ctx.fillStyle = C.white;
  ctx.beginPath();
  ctx.moveTo(plateX, plateY - 8);
  ctx.lineTo(plateX + 10, plateY);
  ctx.lineTo(plateX + 10, plateY + 6);
  ctx.lineTo(plateX - 10, plateY + 6);
  ctx.lineTo(plateX - 10, plateY);
  ctx.closePath();
  ctx.fill();
}

/** Chalk diamond lines */
function drawDiamondChalk(W, H) {
  const cx = W/2, cy = H*0.82;
  const d  = W * 0.22;
  ctx.strokeStyle = C.chalk;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  // first-to-second
  ctx.moveTo(cx + d, cy);
  ctx.lineTo(cx, cy - d * 0.7);
  // second-to-third
  ctx.lineTo(cx - d, cy);
  ctx.stroke();
  ctx.setLineDash([]);
  // bases
  [[cx + d, cy], [cx, cy - d*0.7], [cx - d, cy]].forEach(([bx, by]) => {
    ctx.fillStyle = C.white;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-7, -7, 14, 14);
    ctx.restore();
  });
}

/** Draw the pitcher character */
function drawPitcher(W, H, pitchT) {
  const px = W * 0.5;
  const py = H * 0.62;
  const scale = 1 - pitchT * 0.2; // shrinks as ball leaves
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(scale, scale);

  // body (blue jersey)
  ctx.fillStyle = C.blue;
  roundRect(-10, -30, 20, 26, 4, C.blue);
  // white stripe
  ctx.fillStyle = C.white;
  ctx.fillRect(-2, -30, 4, 26);
  // head
  ctx.fillStyle = '#FFCDD2';
  ctx.beginPath();
  ctx.arc(0, -40, 12, 0, Math.PI * 2);
  ctx.fill();
  // cap
  ctx.fillStyle = C.blue;
  ctx.beginPath();
  ctx.ellipse(0, -47, 13, 6, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-13, -47, 26, 5);
  // cap brim
  ctx.fillStyle = '#003366';
  ctx.beginPath();
  ctx.ellipse(6, -42, 10, 3, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // arm / throw motion
  const armAngle = pitchT < 0.3 ? -0.5 : -0.5 + pitchT * 2;
  ctx.strokeStyle = '#FFCDD2';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, -25);
  ctx.lineTo(10 + Math.cos(armAngle) * 18, -25 + Math.sin(armAngle) * 18);
  ctx.stroke();
  // legs
  ctx.strokeStyle = '#1565C0';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.lineTo(-6, 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(4, -4);
  ctx.lineTo(6, 16);
  ctx.stroke();

  ctx.restore();
}

/** Draw batter character */
function drawBatter(W, H) {
  const bx = W * 0.38;
  const by = H * 0.86;
  ctx.save();
  ctx.translate(bx, by);

  // legs
  ctx.strokeStyle = '#1565C0';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-3,0); ctx.lineTo(-5, 22); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( 3,0); ctx.lineTo( 5, 22); ctx.stroke();

  // body
  ctx.fillStyle = C.white;
  roundRect(-11, -28, 22, 28, 5, C.white);
  // blue pinstripes
  ctx.strokeStyle = C.blue;
  ctx.lineWidth = 1.5;
  for (let sx = -8; sx < 11; sx += 6) {
    ctx.beginPath();
    ctx.moveTo(sx, -28);
    ctx.lineTo(sx, 0);
    ctx.stroke();
  }
  // number on back
  ctx.fillStyle = C.blue;
  ctx.font = 'bold 10px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('5', 0, -10);

  // helmet
  ctx.fillStyle = C.blue;
  ctx.beginPath();
  ctx.arc(0, -38, 13, 0, Math.PI * 2);
  ctx.fill();
  // ear flap
  ctx.beginPath();
  ctx.arc(-10, -32, 7, 0, Math.PI * 2);
  ctx.fill();

  // face
  ctx.fillStyle = '#FFCDD2';
  ctx.beginPath();
  ctx.arc(2, -36, 9, 0, Math.PI * 2);
  ctx.fill();

  // Bat
  const swingRot = state.batSwinging
    ? state.batAngle
    : -0.3; // resting position
  ctx.save();
  ctx.translate(12, -20);
  ctx.rotate(swingRot);
  // handle
  ctx.strokeStyle = '#5D4037';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -34);
  ctx.stroke();
  // barrel
  ctx.fillStyle = '#795548';
  ctx.beginPath();
  ctx.ellipse(0, -38, 6, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** Draw the baseball at current position */
function drawBall(x, y, scale) {
  const r = Math.max(4, 12 * scale);
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(r*0.4, r*0.6, r*0.8, r*0.3, 0, 0, Math.PI*2);
  ctx.fill();
  // ball
  const ballGrad = ctx.createRadialGradient(-r*0.3, -r*0.3, r*0.1, 0, 0, r);
  ballGrad.addColorStop(0, '#FFFFFF');
  ballGrad.addColorStop(1, '#E0E0E0');
  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fill();
  // seams
  ctx.strokeStyle = '#EF9A9A';
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.65, 0.3, 1.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.65, 3.5, 4.6);
  ctx.stroke();
  ctx.restore();
}

/** Draw trajectory arc after a hit */
function drawTrajectory() {
  if (state.trajectoryPts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  state.trajectoryPts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** Confetti particles for home runs */
function spawnConfetti(W) {
  state.confetti = [];
  for (let i = 0; i < 60; i++) {
    state.confetti.push({
      x: Math.random() * W,
      y: -20,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 3,
      color: [C.gold,'#E53935',C.blue,'#fff','#43A047'][Math.floor(Math.random()*5)],
      rot: Math.random() * Math.PI * 2,
      rSpeed: (Math.random()-0.5)*0.2,
      w: 6 + Math.random()*6,
      h: 3 + Math.random()*4,
      life: 1,
    });
  }
}

function updateConfetti(dt) {
  state.confetti.forEach(c => {
    c.x += c.vx;
    c.y += c.vy;
    c.rot += c.rSpeed;
    c.vy += 0.05; // gravity
    c.life -= 0.005;
  });
  state.confetti = state.confetti.filter(c => c.life > 0 && c.y < canvas.height + 20);
}

function drawConfetti() {
  state.confetti.forEach(c => {
    ctx.save();
    ctx.globalAlpha = c.life;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

// ─── Game logic ───────────────────────────────────────────────

function startGame() {
  state = {
    ...state,
    phase: 'idle',
    score: 0,
    pitchesLeft: TOTAL_PITCHES,
    homeRuns: 0,
    hitLog: [],
    meterPos: 0,
    meterDir: 1,
    pitchT: 0,
    swung: false,
    lastOutcome: null,
    ball: { x: 0, y: 0, visible: false },
    batAngle: -0.3,
    batSwinging: false,
    resultTimer: 0,
    trajectoryPts: [],
    crowdParts: [],
    confetti: [],
  };
  updateHUD();
  showScreen('game');
  timingMeter.classList.add('hidden');
  pitchResult.textContent = '';
  setTimeout(startPitch, 800);
}

function startPitch() {
  if (state.pitchesLeft <= 0) { endGame(); return; }
  state.phase   = 'pitching';
  state.pitchT  = 0;
  state.swung   = false;
  state.meterPos = 0;
  state.meterDir = 1;
  state.ball.visible = true;
  state.trajectoryPts = [];
  state.confetti = [];
  pitchResult.textContent = '';
  timingMeter.classList.remove('hidden');
  soundPitch();
}

function doSwing() {
  if (state.phase !== 'pitching' || state.swung) return;
  state.swung = true;
  state.batSwinging = true;
  state.batAngle = -0.3;

  const t = state.meterPos; // 0..1
  let outcome;
  if (t >= PERFECT_MIN && t <= PERFECT_MAX) {
    outcome = 'hr';
  } else if (t >= GOOD_MIN && t <= GOOD_MAX) {
    outcome = 'deep';
  } else if (t > 0.1 && t < 0.9) {
    outcome = 'ground';
  } else {
    outcome = 'miss';
  }

  state.lastOutcome = outcome;
  state.hitLog.push(outcome);
  state.score += SCORES[outcome];
  if (outcome === 'hr') state.homeRuns++;
  state.pitchesLeft--;

  // sounds
  if (outcome === 'miss') soundMiss();
  else if (outcome === 'hr') { soundCrack(); setTimeout(soundHomeRun, 200); spawnConfetti(canvas.width); }
  else soundCrack();

  // feedback
  showFeedback(outcome);

  // trajectory for hits
  if (outcome !== 'miss') {
    buildTrajectory(outcome);
  }

  timingMeter.classList.add('hidden');
  state.phase = 'result';
  state.resultTimer = outcome === 'hr' ? 2200 : 1400;
  updateHUD();
}

const FEEDBACK_LABELS = {
  hr:     { text: '💥 CRUSHED!', color: '#FFD700' },
  deep:   { text: '⚡ DEEP HIT!', color: '#90CAF9' },
  ground: { text: '🏃 GROUNDER', color: '#A5D6A7' },
  miss:   { text: '💨 SWING AND MISS', color: '#EF9A9A' },
};

function showFeedback(outcome) {
  // Update HUD center text
  const info = FEEDBACK_LABELS[outcome];
  pitchResult.textContent = info.text;
  pitchResult.style.color = info.color;

  // Big pop-up feedback
  let el = state.feedbackEl;
  if (!el) {
    el = document.createElement('div');
    el.className = 'feedback-pop';
    document.body.appendChild(el);
    state.feedbackEl = el;
  }
  el.textContent = info.text;
  el.style.color = info.color;
  el.classList.remove('show');
  void el.offsetWidth; // reflow
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 900);
}

/** Build a parabolic trajectory for hit ball animation */
function buildTrajectory(outcome) {
  const W = canvas.width;
  const H = canvas.height;
  const startX = W * 0.5;
  const startY = H * 0.72;
  const pts = [];
  const steps = 40;

  let endX, peakH;
  switch (outcome) {
    case 'hr':    endX = W * 0.5 + (Math.random()-0.5)*W*0.3; peakH = H * 0.15; break;
    case 'deep':  endX = W * 0.5 + (Math.random()-0.5)*W*0.4; peakH = H * 0.28; break;
    default:      endX = W * (0.3 + Math.random()*0.4);         peakH = H * 0.45; break;
  }

  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const x = startX + (endX - startX) * frac;
    // Parabola: y = startY - 4*peakH*frac*(1-frac)
    const y = startY - 4 * peakH * frac * (1 - frac) + (H * 0.22 - startY) * frac;
    pts.push({ x, y });
  }
  state.trajectoryPts = pts;
  // Store current ball anim
  state.ballAnim = { pts, t: 0, speed: outcome === 'miss' ? 0 : 0.03 };
}

function updateHUD() {
  scoreDisplay.textContent = state.score;
  pitchDisplay.textContent = state.pitchesLeft;
}

function endGame() {
  state.phase = 'end';
  showScreen('end');
  if (state.feedbackEl) state.feedbackEl.classList.remove('show');

  document.getElementById('finalScore').textContent = state.score;
  document.getElementById('finalHR').textContent = state.homeRuns;

  // Rating message
  const maxScore = TOTAL_PITCHES * SCORES.hr;
  const pct = state.score / maxScore;
  let msg;
  if (pct >= 0.9)       msg = '🏆 LEGENDARY! Hall of Fame material!';
  else if (pct >= 0.7)  msg = '🌟 AMAZING! Scouts are calling!';
  else if (pct >= 0.5)  msg = '⚡ SOLID GAME! Keep swinging!';
  else if (pct >= 0.25) msg = '👍 Not bad, champ! More practice!';
  else                  msg = '😅 Keep your eye on the ball!';
  document.getElementById('ratingMsg').textContent = msg;

  // Hit log chips
  const logEl = document.getElementById('hitLog');
  logEl.innerHTML = '';
  state.hitLog.forEach((h, i) => {
    const chip = document.createElement('span');
    chip.className = `hit-chip ${h}`;
    chip.textContent = h === 'hr' ? '⚾ HR' : h === 'deep' ? '💥 Deep' : h === 'ground' ? '🏃 Gnd' : '❌';
    logEl.appendChild(chip);
  });
}

// ─── Main loop ────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min(ts - lastTime, 50); // cap at 50ms to prevent big jumps
  lastTime = ts;

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Scene
  drawScene();

  if (state.phase === 'pitching' || state.phase === 'result' || state.phase === 'idle') {
    drawPitcher(canvas.width, canvas.height, state.phase === 'pitching' ? state.pitchT : 0);
    drawBatter(canvas.width, canvas.height);

    if (state.phase === 'pitching') {
      // Advance pitch progress
      state.pitchT = Math.min(1, state.pitchT + dt / PITCH_DURATION);

      // Ball position: pitcher → plate (perspective zoom)
      const W = canvas.width, H = canvas.height;
      const startX = W * 0.5, startY = H * 0.60;
      const endX   = W * 0.46, endY = H * 0.80;
      const t = easeIn(state.pitchT);
      state.ball.x = startX + (endX - startX) * t;
      state.ball.y = startY + (endY - startY) * t;
      const ballScale = 0.3 + t * 0.7;
      drawBall(state.ball.x, state.ball.y, ballScale);

      // Update timing meter
      state.meterPos += state.meterDir * METER_SPEED * dt;
      if (state.meterPos >= 1) { state.meterPos = 1; state.meterDir = -1; }
      if (state.meterPos <= 0) { state.meterPos = 0; state.meterDir = 1; }

      // CSS meter indicator (left% inside track)
      meterInd.style.left = `calc(${state.meterPos * 100}% - 5px)`;

      // Auto miss if pitch reaches plate without swing
      if (state.pitchT >= 1 && !state.swung) {
        state.swung = true;
        doAutoMiss();
      }
    }

    if (state.phase === 'result') {
      // Bat swing animation
      if (state.batSwinging) {
        state.batAngle += dt * 0.012;
        if (state.batAngle > 1.8) { state.batSwinging = false; }
      }

      // Ball anim after hit
      if (state.ballAnim && state.ballAnim.t < 1) {
        state.ballAnim.t = Math.min(1, state.ballAnim.t + state.ballAnim.speed * dt * 0.06);
        const idx = Math.floor(state.ballAnim.t * (state.ballAnim.pts.length - 1));
        const pt  = state.ballAnim.pts[idx];
        if (pt) {
          const scale = 0.3 + (1 - state.ballAnim.t) * 0.8;
          drawTrajectory();
          drawBall(pt.x, pt.y, scale);
        }
      }

      updateConfetti(dt);
      drawConfetti();

      // Countdown to next pitch
      state.resultTimer -= dt;
      if (state.resultTimer <= 0) {
        state.resultTimer = 0;
        state.batSwinging = false;
        state.ballAnim = null;
        if (state.pitchesLeft <= 0) {
          endGame();
        } else {
          state.phase = 'idle';
          setTimeout(startPitch, 400);
        }
      }
    }
  }

  requestAnimationFrame(loop);
}

function doAutoMiss() {
  state.lastOutcome = 'miss';
  state.hitLog.push('miss');
  state.pitchesLeft--;
  showFeedback('miss');
  soundMiss();
  timingMeter.classList.add('hidden');
  state.phase = 'result';
  state.resultTimer = 1200;
  updateHUD();
}

function easeIn(t) {
  return t * t;
}

// ─── Event listeners ──────────────────────────────────────────

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('playAgainBtn').addEventListener('click', startGame);

swingZone.addEventListener('click', () => doSwing());
swingZone.addEventListener('touchstart', (e) => {
  e.preventDefault();
  doSwing();
}, { passive: false });

// ─── Resize handling ──────────────────────────────────────────
function handleResize() {
  resizeCanvas();
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

// ─── Init ─────────────────────────────────────────────────────
resizeCanvas();
showScreen('start');

// Start background loop for start/end screen ambience
requestAnimationFrame(loop);
