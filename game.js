(function (root) {
  'use strict';

  const W = 520;
  const H = 780;
  const PAD = 16;
  const CORNER_R = 26;
  const GOAL_W = 168;
  const GOAL_L = (W - GOAL_W) * 0.5;
  const GOAL_R = GOAL_L + GOAL_W;
  const MALLET_R = 34;
  const PUCK_R = 17;
  const WIN_SCORE = 7;
  const MAX_PUCK_SPEED = 1280;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function createMatchState() {
    return {
      scoreP1: 0,
      scoreAI: 0,
      winner: null, // 'p1' | 'ai' | null
      serveTimer: 0.35,
      serveSide: 'center', // 'center' | 'p1' | 'ai'
      flashSide: null,
      flashAlpha: 0,
      kickX: 0,
      kickY: 0,
      time: 0,
      p1: { x: W * 0.5, y: H * 0.8, vx: 0, vy: 0, targetX: W * 0.5, targetY: H * 0.8 },
      ai: { x: W * 0.5, y: H * 0.2, vx: 0, vy: 0, stuckTimer: 0 },
      puck: { x: W * 0.5, y: H * 0.5, vx: 0, vy: 0, trail: [] },
      ripples: [],
      sparks: []
    };
  }

  function resetPuck(state, side) {
    const y = side === 'p1' ? H * 0.62 : side === 'ai' ? H * 0.38 : H * 0.5;
    state.puck.x = W * 0.5;
    state.puck.y = y;
    state.puck.vx = 0;
    state.puck.vy = 0;
    state.puck.trail = [];
    state.serveSide = side;
    state.serveTimer = 0.72;
  }

  function addRipple(state, x, y, color, maxR = 54) {
    state.ripples.push({ x, y, r: 8, maxR, color, life: 0.36, maxLife: 0.36 });
  }

  function addSparks(state, x, y, color, count = 8, speed = 220) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 0.6) * speed;
      state.sparks.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 2.2,
        color,
        life: 0.24 + Math.random() * 0.16,
        maxLife: 0.4
      });
    }
  }

  function predictPuckXAtY(puck, targetY) {
    if (puck.vy >= -25) return puck.x;
    const t = (targetY - puck.y) / puck.vy;
    if (t <= 0 || t > 1.6) return puck.x;
    let px = puck.x + puck.vx * t;
    const minX = PAD + PUCK_R;
    const maxX = W - PAD - PUCK_R;
    const span = maxX - minX;
    // Mirror reflections off side rails
    let rel = px - minX;
    while (rel < 0 || rel > span) {
      if (rel < 0) rel = -rel;
      if (rel > span) rel = 2 * span - rel;
    }
    return minX + rel;
  }

  function updateAI(state, dt) {
    const ai = state.ai;
    const pk = state.puck;
    const minX = PAD + MALLET_R + 2;
    const maxX = W - PAD - MALLET_R - 2;
    const minY = PAD + MALLET_R + 2;
    const maxY = H * 0.5 - MALLET_R - 4;

    let tx = W * 0.5;
    let ty = PAD + MALLET_R + 54;
    let maxSpeed = 590;

    if (state.serveTimer <= 0 && !state.winner) {
      const puckInAIHalf = pk.y < H * 0.5 + 10;
      const puckBehindAI = pk.y < ai.y - 8;

      if (puckInAIHalf) {
        if (puckBehindAI) {
          // Sweep around puck without hitting own goal
          tx = pk.x < W * 0.5 ? Math.min(maxX, pk.x + 68) : Math.max(minX, pk.x - 68);
          ty = Math.max(minY + 6, pk.y - 24);
          maxSpeed = 620;
        } else {
          // Strike with slight angle aim toward player's open goal side
          const goalBias = state.p1.x < W * 0.5 ? 26 : -26;
          const aimX = W * 0.5 + goalBias;
          const toGoalX = aimX - pk.x;
          const toGoalY = H - PAD - pk.y;
          const len = Math.hypot(toGoalX, toGoalY) || 1;
          tx = pk.x - (toGoalX / len) * (MALLET_R * 0.45);
          ty = pk.y - (toGoalY / len) * (MALLET_R * 0.45);
          maxSpeed = 690;
        }
      } else if (pk.vy < -60) {
        // Incoming shot: intercept smoothly on defensive arc
        const defendY = PAD + MALLET_R + 68;
        tx = clamp(predictPuckXAtY(pk, defendY), GOAL_L - 20, GOAL_R + 20);
        ty = defendY;
        maxSpeed = 640;
      } else {
        // Calm crease guard with subtle shadow tracking
        tx = W * 0.5 + (pk.x - W * 0.5) * 0.36;
        ty = PAD + MALLET_R + 60;
        maxSpeed = 430;
      }
    }

    tx = clamp(tx, minX, maxX);
    ty = clamp(ty, minY, maxY);

    const dx = tx - ai.x;
    const dy = ty - ai.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.min(dist, maxSpeed * dt);
    const prevX = ai.x;
    const prevY = ai.y;
    if (dist > 0.5) {
      ai.x += (dx / dist) * step;
      ai.y += (dy / dist) * step;
    }
    ai.vx = dt > 0 ? (ai.x - prevX) / dt : 0;
    ai.vy = dt > 0 ? (ai.y - prevY) / dt : 0;
  }

  function resolveMalletPuck(state, mallet, color, events) {
    const pk = state.puck;
    const dx = pk.x - mallet.x;
    const dy = pk.y - mallet.y;
    const minDist = MALLET_R + PUCK_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist) return;

    const d = Math.sqrt(d2) || 0.001;
    const nx = dx / d;
    const ny = dy / d;

    // Separate puck cleanly outside mallet radius
    pk.x = mallet.x + nx * (minDist + 0.5);
    pk.y = mallet.y + ny * (minDist + 0.5);

    const rvx = pk.vx - mallet.vx;
    const rvy = pk.vy - mallet.vy;
    const vn = rvx * nx + rvy * ny;

    if (vn < 0) {
      const restitution = 0.92;
      const impulse = -(1 + restitution) * vn;
      pk.vx += impulse * nx + mallet.vx * 0.22;
      pk.vy += impulse * ny + mallet.vy * 0.22;

      const sp = Math.hypot(pk.vx, pk.vy);
      if (sp > MAX_PUCK_SPEED) {
        pk.vx = (pk.vx / sp) * MAX_PUCK_SPEED;
        pk.vy = (pk.vy / sp) * MAX_PUCK_SPEED;
      }

      const hitStrength = Math.abs(vn);
      if (hitStrength > events.hitSpeed) {
        events.hitSpeed = hitStrength;
        events.hitType = 'mallet';
      }

      if (hitStrength > 220) {
        addRipple(state, mallet.x + nx * MALLET_R, mallet.y + ny * MALLET_R, color, 48);
        addSparks(state, mallet.x + nx * MALLET_R, mallet.y + ny * MALLET_R, color, 7, 210);
        const kick = Math.min(4.5, hitStrength / 260);
        state.kickX = nx * kick;
        state.kickY = ny * kick;
      }
    }
  }

  function stepMatch(state, dt, keys = null) {
    const events = { hitSpeed: 0, hitType: null, goal: null, winner: null };
    const cdt = Math.min(0.032, Math.max(0.001, dt));
    state.time += cdt;

    // Decay visual effects
    state.kickX *= 0.8;
    state.kickY *= 0.8;
    if (state.flashAlpha > 0) state.flashAlpha = Math.max(0, state.flashAlpha - cdt * 1.9);

    for (let i = state.ripples.length - 1; i >= 0; i--) {
      const rp = state.ripples[i];
      rp.life -= cdt;
      rp.r = 8 + (1 - rp.life / rp.maxLife) * (rp.maxR - 8);
      if (rp.life <= 0) state.ripples.splice(i, 1);
    }
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const sp = state.sparks[i];
      sp.x += sp.vx * cdt;
      sp.y += sp.vy * cdt;
      sp.vx *= 0.92;
      sp.vy *= 0.92;
      sp.life -= cdt;
      if (sp.life <= 0) state.sparks.splice(i, 1);
    }

    // Optional keyboard glide for player mallet
    const p1 = state.p1;
    if (keys) {
      const kSpeed = 720 * cdt;
      if (keys.left) p1.targetX -= kSpeed;
      if (keys.right) p1.targetX += kSpeed;
      if (keys.up) p1.targetY -= kSpeed;
      if (keys.down) p1.targetY += kSpeed;
    }

    // Clamp player mallet strictly to bottom half
    const pMinX = PAD + MALLET_R + 1;
    const pMaxX = W - PAD - MALLET_R - 1;
    const pMinY = H * 0.5 + MALLET_R + 2;
    const pMaxY = H - PAD - MALLET_R - 1;
    p1.targetX = clamp(p1.targetX, pMinX, pMaxX);
    p1.targetY = clamp(p1.targetY, pMinY, pMaxY);

    const prevP1X = p1.x;
    const prevP1Y = p1.y;
    const follow = 1 - Math.exp(-38 * cdt);
    p1.x += (p1.targetX - p1.x) * follow;
    p1.y += (p1.targetY - p1.y) * follow;
    p1.vx = (p1.x - prevP1X) / cdt;
    p1.vy = (p1.y - prevP1Y) / cdt;

    updateAI(state, cdt);

    if (state.winner) return events;

    if (state.serveTimer > 0) {
      state.serveTimer = Math.max(0, state.serveTimer - cdt);
      return events;
    }

    // 8-substep precision puck simulation
    const substeps = 8;
    const sdt = cdt / substeps;
    const pk = state.puck;
    const leftX = PAD + PUCK_R;
    const rightX = W - PAD - PUCK_R;
    const topY = PAD + PUCK_R;
    const botY = H - PAD - PUCK_R;

    for (let s = 0; s < substeps; s++) {
      pk.x += pk.vx * sdt;
      pk.y += pk.vy * sdt;

      // Air-table low friction
      const damp = Math.exp(-0.24 * sdt);
      pk.vx *= damp;
      pk.vy *= damp;

      // Side rails
      if (pk.x < leftX) {
        const sp = Math.abs(pk.vx);
        pk.x = leftX;
        pk.vx = Math.abs(pk.vx) * 0.9;
        if (sp > events.hitSpeed) { events.hitSpeed = sp; events.hitType = 'wall'; }
        if (sp > 240) addSparks(state, PAD, pk.y, '#94a3b8', 5, 140);
      } else if (pk.x > rightX) {
        const sp = Math.abs(pk.vx);
        pk.x = rightX;
        pk.vx = -Math.abs(pk.vx) * 0.9;
        if (sp > events.hitSpeed) { events.hitSpeed = sp; events.hitType = 'wall'; }
        if (sp > 240) addSparks(state, W - PAD, pk.y, '#94a3b8', 5, 140);
      }

      // Top & bottom walls with open goal mouths
      const inGoalX = pk.x > GOAL_L + PUCK_R * 0.45 && pk.x < GOAL_R - PUCK_R * 0.45;

      if (pk.y < topY) {
        if (inGoalX) {
          if (pk.y < PAD - PUCK_R * 0.5) {
            state.scoreP1 += 1;
            events.goal = 'p1';
            state.flashSide = 'top';
            state.flashAlpha = 1;
            state.kickY = -5;
            addRipple(state, pk.x, PAD, '#2563eb', 120);
            addSparks(state, pk.x, PAD + 6, '#2563eb', 16, 300);
            if (state.scoreP1 >= WIN_SCORE) {
              state.winner = 'p1';
              events.winner = 'p1';
            } else {
              resetPuck(state, 'ai');
            }
            return events;
          }
        } else {
          const sp = Math.abs(pk.vy);
          pk.y = topY;
          pk.vy = Math.abs(pk.vy) * 0.9;
          if (sp > events.hitSpeed) { events.hitSpeed = sp; events.hitType = 'wall'; }
          if (sp > 240) addSparks(state, pk.x, PAD, '#94a3b8', 5, 140);
        }
      } else if (pk.y > botY) {
        if (inGoalX) {
          if (pk.y > H - PAD + PUCK_R * 0.5) {
            state.scoreAI += 1;
            events.goal = 'ai';
            state.flashSide = 'bottom';
            state.flashAlpha = 1;
            state.kickY = 5;
            addRipple(state, pk.x, H - PAD, '#f43f5e', 120);
            addSparks(state, pk.x, H - PAD - 6, '#f43f5e', 16, 300);
            if (state.scoreAI >= WIN_SCORE) {
              state.winner = 'ai';
              events.winner = 'ai';
            } else {
              resetPuck(state, 'p1');
            }
            return events;
          }
        } else {
          const sp = Math.abs(pk.vy);
          pk.y = botY;
          pk.vy = -Math.abs(pk.vy) * 0.9;
          if (sp > events.hitSpeed) { events.hitSpeed = sp; events.hitType = 'wall'; }
          if (sp > 240) addSparks(state, pk.x, H - PAD, '#94a3b8', 5, 140);
        }
      }

      // Mallet-Puck collisions
      resolveMalletPuck(state, p1, '#2563eb', events);
      resolveMalletPuck(state, state.ai, '#f43f5e', events);

      // Re-clamp puck inside walls so mallet cannot push puck out of bounds
      if (pk.x < leftX) pk.x = leftX;
      if (pk.x > rightX) pk.x = rightX;
      if (!inGoalX) {
        if (pk.y < topY) pk.y = topY;
        if (pk.y > botY) pk.y = botY;
      }
    }

    // Silky trail ribbon
    const speed = Math.hypot(pk.vx, pk.vy);
    if (speed > 45) {
      pk.trail.push({ x: pk.x, y: pk.y });
      if (pk.trail.length > 16) pk.trail.shift();
    } else if (pk.trail.length > 0) {
      pk.trail.shift();
    }

    return events;
  }

  // Export engine for Node testing
  const engineApi = {
    W,
    H,
    PAD,
    GOAL_L,
    GOAL_R,
    MALLET_R,
    PUCK_R,
    WIN_SCORE,
    createMatchState,
    resetPuck,
    stepMatch
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engineApi;
    return;
  }

  // Browser Runtime: Minimal Audio + HiDPI Architectural Renderer + Controls
  class HockeyAudio {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.lastHit = 0;
    }

    ensure() {
      if (this.muted) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }

    playHit(speed, type) {
      const ctx = this.ensure();
      if (!ctx || speed < 55) return;
      const now = ctx.currentTime;
      if (now - this.lastHit < 0.032) return;
      this.lastHit = now;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === 'mallet' ? 'triangle' : 'sine';
      const baseFreq = type === 'mallet' ? 280 : 520;
      osc.frequency.setValueAtTime(baseFreq + Math.min(340, speed * 0.35), now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.45, now + 0.05);
      const vol = Math.min(0.11, 0.02 + speed / 8500);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    }

    playGoal(isPlayer) {
      const ctx = this.ensure();
      if (!ctx) return;
      const now = ctx.currentTime;
      const notes = isPlayer ? [523.25, 659.25, 783.99] : [392.0, 329.63];
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const t = now + i * 0.07;
        osc.frequency.setValueAtTime(f, t);
        gain.gain.setValueAtTime(0.085, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    }
  }

  const canvas = document.getElementById('court');
  const ctx = canvas.getContext('2d');
  const muteBtn = document.getElementById('mute-btn');
  const iconOn = document.getElementById('icon-on');
  const iconOff = document.getElementById('icon-off');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const audio = new HockeyAudio();

  function setupHiDPI() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupHiDPI();
  window.addEventListener('resize', setupHiDPI);

  function loadImg(src) {
    const img = new Image();
    img.ready = false;
    img.onload = () => { img.ready = true; };
    img.src = src;
    return img;
  }
  const portraits = {
    p1: loadImg('assets/carter-normal.jpg'),
    ai: loadImg('assets/carter-white.jpg')
  };

  let state = createMatchState();
  const keys = { left: false, right: false, up: false, down: false };

  function toCourt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H
    };
  }

  canvas.addEventListener('pointermove', (e) => {
    const pt = toCourt(e.clientX, e.clientY);
    state.p1.targetX = pt.x;
    state.p1.targetY = pt.y;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    audio.ensure();
    if (state.winner) {
      state = createMatchState();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    const pt = toCourt(e.clientX, e.clientY);
    state.p1.targetX = pt.x;
    state.p1.targetY = pt.y;
  });

  window.addEventListener('keydown', (e) => {
    if (state.winner && (e.code === 'Space' || e.key === 'Enter')) {
      e.preventDefault();
      state = createMatchState();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = true;
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = false;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
  });

  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    iconOn.hidden = audio.muted;
    iconOff.hidden = !audio.muted;
    muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute sound' : 'Mute sound');
  });

  function drawMallet(x, y, role) {
    const isP1 = role === 'p1';
    const accent = isP1 ? '#2563eb' : '#f43f5e';
    const img = portraits[role];

    ctx.save();
    ctx.translate(x, y);

    // Soft studio shadow
    ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
    ctx.beginPath();
    ctx.arc(0, 5, MALLET_R * 0.98, 0, Math.PI * 2);
    ctx.fill();

    // Crisp porcelain mallet body
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, MALLET_R, 0, Math.PI * 2);
    ctx.fill();

    // Real Carter portrait clipped smoothly inside striker
    if (img && img.ready && img.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, MALLET_R - 4.5, 0, Math.PI * 2);
      ctx.clip();
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const crop = isP1
        ? { sx: iw * 0.12, sy: ih * 0.05, sw: iw * 0.76, sh: ih * 0.76 }
        : { sx: iw * 0.21, sy: ih * 0.26, sw: iw * 0.58, sh: ih * 0.44 };
      const d = (MALLET_R - 4.5) * 2;
      ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, -(MALLET_R - 4.5), -(MALLET_R - 4.5), d, d);
      ctx.restore();
    }

    // Anodized team rim
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, MALLET_R - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle specular glass highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.beginPath();
    ctx.ellipse(-9, -11, 10, 5.5, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function render() {
    const noMotion = reducedMotion.matches;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    if (!noMotion) ctx.translate(state.kickX, state.kickY);

    // 1. Pure Porcelain Architectural Table Surface
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.5, '#fcfdfe');
    bg.addColorStop(1, '#f8fafc');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, CORNER_R + 4);
    ctx.fill();

    // Goal flash wash
    if (state.flashAlpha > 0) {
      const col = state.flashSide === 'top' ? '37, 99, 235' : '244, 63, 94';
      const gy = state.flashSide === 'top' ? 0 : H;
      const g = ctx.createRadialGradient(W * 0.5, gy, 10, W * 0.5, gy, 340);
      g.addColorStop(0, `rgba(${col}, ${state.flashAlpha * 0.22})`);
      g.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Whisper-Faint Architectural Scores Painted Directly on the Ice
    ctx.save();
    ctx.font = '700 132px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(244, 63, 94, 0.085)';
    ctx.fillText(String(state.scoreAI), W * 0.5, H * 0.27);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.085)';
    ctx.fillText(String(state.scoreP1), W * 0.5, H * 0.73);
    ctx.restore();

    // 3. Hairline Court Geometry
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;

    // Center line + faceoff circle
    ctx.beginPath();
    ctx.moveTo(PAD, H * 0.5);
    ctx.lineTo(W - PAD, H * 0.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, 62, 0, Math.PI * 2);
    ctx.stroke();

    // Goal creases
    ctx.beginPath();
    ctx.arc(W * 0.5, PAD, GOAL_W * 0.5, 0, Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(W * 0.5, H - PAD, GOAL_W * 0.5, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Outer architectural rail frame (open at the two goals)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(GOAL_L, PAD);
    ctx.lineTo(PAD + 14, PAD);
    ctx.quadraticCurveTo(PAD, PAD, PAD, PAD + 14);
    ctx.lineTo(PAD, H - PAD - 14);
    ctx.quadraticCurveTo(PAD, H - PAD, PAD + 14, H - PAD);
    ctx.lineTo(GOAL_L, H - PAD);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(GOAL_R, PAD);
    ctx.lineTo(W - PAD - 14, PAD);
    ctx.quadraticCurveTo(W - PAD, PAD, W - PAD, PAD + 14);
    ctx.lineTo(W - PAD, H - PAD - 14);
    ctx.quadraticCurveTo(W - PAD, H - PAD, W - PAD - 14, H - PAD);
    ctx.lineTo(GOAL_R, H - PAD);
    ctx.stroke();

    // Crisp colored goal slits
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(GOAL_L + 4, PAD);
    ctx.lineTo(GOAL_R - 4, PAD);
    ctx.stroke();

    ctx.strokeStyle = '#2563eb';
    ctx.beginPath();
    ctx.moveTo(GOAL_L + 4, H - PAD);
    ctx.lineTo(GOAL_R - 4, H - PAD);
    ctx.stroke();

    // 4. Impact Ripples & Micro-Sparks
    for (const rp of state.ripples) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, (rp.life / rp.maxLife) * 0.55);
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const sp of state.sparks) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Silky Puck Trail & Anodized Slate Puck
    const pk = state.puck;
    if (!state.winner) {
      for (let i = 0; i < pk.trail.length; i++) {
        const t = (i + 1) / pk.trail.length;
        ctx.fillStyle = `rgba(15, 23, 42, ${t * 0.14})`;
        ctx.beginPath();
        ctx.arc(pk.trail[i].x, pk.trail[i].y, PUCK_R * (0.35 + t * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }

      const scale = state.serveTimer > 0 ? 1 - (state.serveTimer / 0.72) * 0.2 : 1;
      const pr = PUCK_R * scale;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
      ctx.beginPath();
      ctx.arc(pk.x, pk.y + 3, pr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, pr, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, pr * 0.52, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 6. Both Portrait Mallets
    drawMallet(state.ai.x, state.ai.y, 'ai');
    drawMallet(state.p1.x, state.p1.y, 'p1');

    // 7. Whisper-Clean Minimal Match End Banner
    if (state.winner) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.fillRect(0, 0, W, H);

      const isP1 = state.winner === 'p1';
      ctx.fillStyle = isP1 ? '#2563eb' : '#f43f5e';
      ctx.font = '700 32px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isP1 ? 'CARTER WINS' : 'WHITE CARTER WINS', W * 0.5, H * 0.47);

      ctx.fillStyle = '#64748b';
      ctx.font = '500 15px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillText('Click anywhere to rematch', W * 0.5, H * 0.53);
    }

    ctx.restore();
  }

  let lastTs = performance.now();
  function loop(now) {
    const dt = (now - lastTs) / 1000;
    lastTs = now;

    const ev = stepMatch(state, dt, keys);
    if (ev.hitSpeed > 55) audio.playHit(ev.hitSpeed, ev.hitType);
    if (ev.goal) audio.playGoal(ev.goal === 'p1');

    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})(typeof window !== 'undefined' ? window : globalThis);
