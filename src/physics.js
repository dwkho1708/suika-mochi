// Matter.js 물리 엔진 + 합치기 + 위험선 (기획서 §6.5, §6.6, §6.7)

(() => {
  'use strict';

  const W = 420, H = 540, DANGER_Y = 70;
  const WALL_THICKNESS = 36;

  const DESSERT_BODY_OPTS = {
    restitution: 0.25,
    friction: 0.05,
    frictionStatic: 0.5,
    density: 0.001,
    slop: 0.05,
  };

  let engine, world;
  let onMergeCb = null;
  let onKingBonusCb = null;
  let onGameOverCb = null;
  let isOver = false;
  let isPaused = false;

  function init() {
    // 기존 인스턴스 정리 (메인 ↔ 게임 왕복 시 누수 방지)
    if (engine) {
      try {
        Matter.Events.off(engine, 'collisionStart', handleCollision);
        Matter.World.clear(world, false);
        Matter.Engine.clear(engine);
      } catch {}
    }
    engine = Matter.Engine.create({
      positionIterations: 8,
      velocityIterations: 6,
    });
    engine.world.gravity.y = 2.2; // 빠른 손맛. positionIterations 8로 침투 보강
    world = engine.world;
    isOver = false;
    isPaused = false;

    const wallOpts = { isStatic: true, friction: 0.1, restitution: 0.2, render: { visible: false } };
    Matter.World.add(world, [
      Matter.Bodies.rectangle(W / 2, H + WALL_THICKNESS / 2, W + WALL_THICKNESS * 2, WALL_THICKNESS, wallOpts), // bottom
      Matter.Bodies.rectangle(-WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H * 2, wallOpts), // left
      Matter.Bodies.rectangle(W + WALL_THICKNESS / 2, H / 2, WALL_THICKNESS, H * 2, wallOpts), // right
    ]);

    Matter.Events.on(engine, 'collisionStart', handleCollision);
    // Runner는 RAF 의존이라 hidden 탭에서 멈춤 → 외부 game loop에서 step() 직접 호출
  }

  // 외부 loop에서 매 프레임 호출. dt: 밀리초.
  function step(dt) {
    if (!engine || isPaused || isOver) return;
    Matter.Engine.update(engine, Math.min(33, dt));
  }

  function reset() {
    if (engine) {
      Matter.Events.off(engine, 'collisionStart', handleCollision);
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    }
    init();
  }

  function setPaused(p) {
    isPaused = p;
  }

  function spawnDessert(id, x, y, isStatic = false) {
    const d = Desserts.getDessert(id);
    // 항상 dynamic으로 만든 후 필요 시 setStatic(true)로 전환.
    // (옵션에 isStatic:true를 직접 넘기면 mass가 0으로 고정되어
    //  나중에 setStatic(false) 시 inverseMass가 복구되지 않는 matter.js 버그 회피)
    const body = Matter.Bodies.circle(x, y, d.radius, { ...DESSERT_BODY_OPTS });
    body.dessertId = id;
    body.hasCollided = false;
    body.gracePeriod = 500; // ms — 드롭 직후 위험선 판정 유예
    body.dangerTime = 0;
    body.isMerging = false;
    Matter.World.add(world, body);
    if (isStatic) Matter.Body.setStatic(body, true);
    return body;
  }

  function releaseDessert(body) {
    if (!body) return;
    Matter.Body.setStatic(body, false);
    body.gracePeriod = 500;
  }

  function moveStaticDessert(body, x) {
    if (!body || !body.isStatic) return;
    Matter.Body.setPosition(body, { x, y: body.position.y });
  }

  function handleCollision(e) {
    if (isOver) return;
    const merged = new Set();
    for (const pair of e.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.dessertId) a.hasCollided = true;
      if (b.dessertId) b.hasCollided = true;
      if (!a.dessertId || !b.dessertId) continue;
      if (a.isMerging || b.isMerging) continue;
      if (merged.has(a.id) || merged.has(b.id)) continue;
      if (a.dessertId !== b.dessertId) continue;
      merged.add(a.id);
      merged.add(b.id);
      mergePair(a, b);
    }
  }

  function mergePair(a, b) {
    a.isMerging = true;
    b.isMerging = true;
    const mx = (a.position.x + b.position.x) / 2;
    const my = (a.position.y + b.position.y) / 2;
    const oldId = a.dessertId;
    Matter.World.remove(world, [a, b]);

    if (oldId >= Desserts.MAX_LEVEL) {
      // 11→11: 새 디저트 생성 X, 보너스만
      if (onKingBonusCb) onKingBonusCb({ x: mx, y: my });
      return;
    }

    const newBody = spawnDessert(oldId + 1, mx, my, false);
    newBody.hasCollided = true;
    newBody.gracePeriod = 0;

    // 충격파: 주변 디저트에 미세 force (물리 꼬임 방지)
    const radiusCheck = Desserts.getDessert(oldId + 1).radius + 30;
    for (const body of getDynamicBodies()) {
      if (body === newBody) continue;
      const dx = body.position.x - mx;
      const dy = body.position.y - my;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0 || dist > radiusCheck) continue;
      const f = 0.0006 * body.mass;
      Matter.Body.applyForce(body, body.position, { x: (dx / dist) * f, y: (dy / dist) * f });
    }

    if (onMergeCb) onMergeCb({ newId: oldId + 1, x: mx, y: my, mergedFromId: oldId, newBody });
  }

  function getDynamicBodies() {
    return world.bodies.filter(b => b.dessertId && !b.isStatic);
  }

  function tickDangerCheck(dt) {
    if (isOver || isPaused) return;
    for (const body of getDynamicBodies()) {
      if (body.gracePeriod > 0) { body.gracePeriod -= dt; continue; }
      if (!body.hasCollided) continue;
      if (body.bounds.min.y < DANGER_Y) {
        body.dangerTime += dt;
        if (body.dangerTime > 2000) {
          isOver = true;
          if (onGameOverCb) onGameOverCb();
          return;
        }
      } else {
        body.dangerTime = 0;
      }
    }
  }

  // 망치로 body 제거 — 좌표 (x,y) 에서 가장 가까운 디저트 1개 (반경 내) 제거.
  function removeBodyAt(x, y, maxDist = 60) {
    let best = null;
    let bestDist = Infinity;
    for (const body of getDynamicBodies()) {
      const dx = body.position.x - x;
      const dy = body.position.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const d_eff = d - (Desserts.getDessert(body.dessertId)?.radius || 0);
      if (d_eff < maxDist && d < bestDist) {
        best = body;
        bestDist = d;
      }
    }
    if (best) {
      Matter.World.remove(world, best);
      return { x: best.position.x, y: best.position.y, dessertId: best.dessertId };
    }
    return null;
  }

  // 게임오버 해제 — 망치 부수기 끝나고 게임 재개용. 위험선 카운트 모두 리셋.
  function resumeAfterGameOver() {
    isOver = false;
    for (const body of getDynamicBodies()) {
      body.dangerTime = 0;
      body.gracePeriod = 600; // 잠시 면제
    }
  }

  function isAnyOverDanger() {
    for (const body of getDynamicBodies()) {
      if (body.gracePeriod > 0 || !body.hasCollided) continue;
      if (body.bounds.min.y < DANGER_Y) return true;
    }
    return false;
  }

  function computeFillRatio() {
    let total = 0;
    const maxArea = W * H * 0.5; // 절반 차면 1.0 근접
    for (const body of getDynamicBodies()) {
      const d = Desserts.getDessert(body.dessertId);
      total += Math.PI * d.radius * d.radius;
    }
    return Math.min(1, total / maxArea);
  }

  window.Physics = {
    W, H, DANGER_Y, WALL_THICKNESS,
    init, reset, setPaused, step,
    spawnDessert, releaseDessert, moveStaticDessert,
    tickDangerCheck, isAnyOverDanger, computeFillRatio,
    getDynamicBodies,
    removeBodyAt, resumeAfterGameOver,
    onMerge: (cb) => { onMergeCb = cb; },
    onKingBonus: (cb) => { onKingBonusCb = cb; },
    onGameOver: (cb) => { onGameOverCb = cb; },
    get isOver() { return isOver; },
    get isPaused() { return isPaused; },
  };
})();
