// Canvas 렌더 (스프라이트 blit + 통통 스케일 + 별 파티클 + 위험선 경고) — 기획서 §6.8 / §7

(() => {
  'use strict';

  let canvas, ctx, dpr = 1;
  let particles = [];
  const MAX_PARTICLES = 100;
  const bumpMap = new WeakMap(); // body → bump 시작 시각 (ms)

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
  }

  // 캔버스 내부 좌표계는 항상 Physics.W × Physics.H (420 × 540).
  // CSS는 부모 wrapper가 aspect-ratio로 결정 → 늘려도 비율 유지.
  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Physics.W * dpr;
    canvas.height = Physics.H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 합치기 시점에 호출 — 통통 모션 트리거
  function bumpBody(body) {
    if (!body) return;
    bumpMap.set(body, performance.now());
  }

  function bumpScale(body, now) {
    const start = bumpMap.get(body);
    if (start == null) return 1;
    const dur = 420;
    const t = (now - start) / dur;
    if (t >= 1) { bumpMap.delete(body); return 1; }
    // 0 → overshoot 1.18 → 1, cubic-bezier overshoot 근사
    const e = 1 - Math.pow(1 - t, 3);
    const overshoot = Math.sin(t * Math.PI) * 0.22; // 위로 솟구쳤다 가라앉음
    return 0.78 + e * 0.22 + overshoot;
  }

  function drawStar(x, y, r, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.translate(x, y);
    ctx.beginPath();
    const spikes = 5;
    for (let i = 0; i < spikes * 2; i++) {
      const rad = (i % 2 === 0) ? r : r * 0.45;
      const ang = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function spawnMergeParticles(x, y, color = '#FFD86B', count = 14) {
    for (let i = 0; i < count; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.4 + Math.random() * 2.8;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.8,
        life: 1,
        decay: 0.022 + Math.random() * 0.02,
        size: 2.5 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3,
        shape: Math.random() < 0.55 ? 'star' : 'circle',
        color,
      });
    }
  }

  function spawnKingBurst(x, y) {
    const colors = ['#FFD86B', '#FF8FA3', '#B89AE8', '#7AC59A', '#FFAFC5', '#FFFFFF'];
    for (let i = 0; i < 60; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      const a = (i / 60) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 2.5 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.01,
        size: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.4,
        shape: 'star',
        color: colors[i % colors.length],
      });
    }
  }

  function updateParticles() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.16;
      p.vx *= 0.99;
      p.rot += p.spin;
      p.life -= p.decay;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life);
      if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawStar(0, 0, p.size, p.color, a);
        ctx.restore();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawDropGuide(x) {
    if (x == null) return;
    ctx.save();
    ctx.strokeStyle = '#FFCDD6';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, Physics.H);
    ctx.stroke();
    ctx.restore();
  }

  function drawDessert(body, now, opts = {}) {
    const sprite = Desserts.getSprite(body.dessertId);
    if (!sprite) return;
    const d = Desserts.getDessert(body.dessertId);
    const r = d.radius;
    const scale = bumpScale(body, now) * (opts.scale || 1);
    // 살짝 그림자 (둥실 느낌)
    ctx.save();
    ctx.translate(body.position.x, body.position.y + r * 0.55);
    ctx.scale(scale, 0.35 * scale);
    ctx.fillStyle = 'rgba(120, 80, 50, 0.12)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(body.position.x, body.position.y + (opts.yOffset || 0));
    ctx.rotate(body.angle);
    ctx.scale(scale, scale);
    ctx.drawImage(sprite.canvas, -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  function drawDangerFlash(t) {
    if (!Physics.isAnyOverDanger()) return;
    const pulse = 0.18 + Math.abs(Math.sin(t / 160)) * 0.3;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#FFBFCB';
    ctx.fillRect(0, 0, Physics.W, Physics.DANGER_Y);
    ctx.restore();
  }

  function render(state) {
    const now = performance.now();
    ctx.clearRect(0, 0, Physics.W, Physics.H);
    drawDangerFlash(state.t);
    drawDropGuide(state.dropX);
    for (const body of Physics.getDynamicBodies()) {
      drawDessert(body, now);
    }
    // pendingBody는 살짝 둥실 (sin)
    if (state.pendingBody) {
      const bob = Math.sin(state.t / 280) * 1.6;
      drawDessert(state.pendingBody, now, { yOffset: bob });
    }
    updateParticles();
    drawParticles();
  }

  window.Render = {
    init, resize, render,
    spawnMergeParticles, spawnKingBurst,
    bumpBody,
  };
})();
