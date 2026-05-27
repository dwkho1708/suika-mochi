// 스이카: 모찌&디저트 — 게임 진입 + 입력 + 점수/콤보 + 결과 + 사운드 hook

(() => {
  'use strict';

  // ==========================================
  // 화면 / 모달
  // ==========================================
  function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (!target) return;
    target.classList.add('active');
    // 직전 버튼 포커스 해제 — 스페이스가 그 버튼 click을 재트리거하는 것 방지
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (screenId === 'game-screen') startGame();
    else stopGame();
    // 첫 인터랙션 시점에 오디오 컨텍스트 깨우기 (브라우저 정책)
    if (window.Audio2) Audio2.unlock();
  }
  function openModal(id) { document.getElementById(id)?.classList.add('active'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('active'); }

  // ==========================================
  // 게임 상태
  // ==========================================
  const state = {
    running: false,
    score: 0,
    displayScore: 0,
    combo: 0,
    comboMultiplier: 1,
    comboTimer: 0,
    comboWindow: 1500,
    lastMergeAt: 0,
    merges: 0,
    maxCombo: 0,
    kingCakes: 0,
    pendingBody: null,
    nextId: 1,
    dropX: Physics.W / 2,
    cooldown: 0,
    t: 0,
    lastFrame: 0,
    dangerToneCooldown: 0,
    // 부활(망치) 모드
    reviveUsed: false,
    hammerMode: false,
    hammerRemaining: 0,
  };
  let store = null;

  // ==========================================
  // NEXT 동적 확률 풀 (기획서 §3.2)
  // ==========================================
  function pickNextId() {
    const r = Physics.computeFillRatio();
    let pool;
    if (r < 0.35) pool = [1, 1, 2, 2, 3, 3, 4, 5];
    else if (r < 0.65) pool = [1, 1, 1, 2, 2, 3, 3, 4];
    else pool = [1, 1, 1, 1, 2, 2, 3];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ==========================================
  // 콤보 윈도우 (기획서 §3.6 유동적)
  // ==========================================
  function comboWindowFor(level) {
    if (level >= 11) return 2500;
    if (level >= 9) return 2000;
    if (level >= 6) return 1800;
    return 1500;
  }
  function multiplierFor(combo) {
    if (combo >= 8) return 2.5;
    if (combo >= 5) return 2.0;
    if (combo >= 4) return 1.8;
    if (combo >= 3) return 1.5;
    if (combo >= 2) return 1.2;
    return 1.0;
  }

  // ==========================================
  // 라이프사이클
  // ==========================================
  let _startingUp = false;
  async function startGame() {
    if (state.running || _startingUp) return; // await 중 재진입 방지
    _startingUp = true;
    store = Storage.load();
    document.getElementById('ui-best').textContent = store.bestScore.toLocaleString();
    // 사운드 토글 초기 상태 동기화
    syncSoundToggle();

    const canvas = document.getElementById('game-canvas');
    Render.init(canvas);

    if (!Desserts.getSprite(1)) {
      await Desserts.prerenderSprites();
    }

    Physics.init();
    Physics.onMerge(handleMerge);
    Physics.onKingBonus(handleKingBonus);
    Physics.onGameOver(handleGameOver);

    resetState();
    spawnPending();
    state.running = true;
    _startingUp = false;
    state.lastFrame = performance.now();
    bindInputs();
    scheduleNextFrame();
  }

  // RAF 우선, hidden 탭에선 setTimeout fallback — 게임 진행 안 멈추게.
  function scheduleNextFrame() {
    if (document.hidden) {
      setTimeout(() => loop(performance.now()), 33);
    } else {
      requestAnimationFrame(loop);
    }
  }

  function stopGame() {
    state.running = false;
    _startingUp = false;
    unbindInputs();
    Physics.setPaused(false);
  }

  function resetState() {
    state.score = 0;
    state.displayScore = 0;
    state.combo = 0;
    state.comboMultiplier = 1;
    state.comboTimer = 0;
    state.merges = 0;
    state.maxCombo = 0;
    state.kingCakes = 0;
    state.cooldown = 0;
    state.t = 0;
    state.pendingBody = null;
    state.nextId = pickNextId();
    state.dangerToneCooldown = 0;
    state.reviveUsed = false;
    state.hammerMode = false;
    state.hammerRemaining = 0;
    document.getElementById('game-screen')?.classList.remove('hammer-mode');
    document.getElementById('hammer-banner')?.classList.remove('show');
    updateScoreUI(true);
    updateComboUI();
    updateNextPreview();
  }

  // ==========================================
  // Pending 디저트 (통 위 대기)
  // ==========================================
  function spawnPending() {
    const id = state.nextId;
    const d = Desserts.getDessert(id);
    const y = Math.max(30, d.radius + 6);
    state.pendingBody = Physics.spawnDessert(id, state.dropX, y, true);
    state.nextId = pickNextId();
    updateNextPreview();
  }

  function dropPending() {
    if (!state.pendingBody || state.cooldown > 0) return;
    Physics.releaseDessert(state.pendingBody);
    if (window.Audio2) Audio2.playDrop();
    state.pendingBody = null;
    state.cooldown = 600;
  }

  // ==========================================
  // 합치기 이벤트
  // ==========================================
  function handleMerge({ newId, x, y, mergedFromId, newBody }) {
    state.merges++;
    const base = Desserts.getDessert(mergedFromId).mergeScore;
    const now = performance.now();
    if (now - state.lastMergeAt <= state.comboWindow) {
      state.combo++;
    } else {
      state.combo = 1;
    }
    state.lastMergeAt = now;
    state.comboWindow = comboWindowFor(newId);
    state.comboMultiplier = multiplierFor(state.combo);
    if (state.combo > state.maxCombo) state.maxCombo = state.combo;

    const gained = Math.round(base * state.comboMultiplier);
    state.score += gained;
    updateScoreUI();
    updateComboUI();
    if (state.combo >= 2) showComboToast(state.combo, state.comboMultiplier);

    Render.bumpBody(newBody);
    Render.spawnMergeParticles(x, y, '#FFD86B', 18);

    if (window.Audio2) {
      Audio2.playMerge(newId);
      if (state.combo >= 2) Audio2.playCombo(state.combo);
    }
    maybeUpdateBestLive();
  }

  function handleKingBonus({ x, y }) {
    state.kingCakes++;
    state.score += Desserts.KING_BONUS;
    updateScoreUI();
    Render.spawnKingBurst(x, y);
    Render.spawnKingBurst(Physics.W / 2, Physics.H / 2);
    showKingToast();
    if (window.Audio2) Audio2.playKing();
    maybeUpdateBestLive();
  }

  function handleGameOver() {
    state.running = false;
    unbindInputs();
    store.totalGames++;
    store.totalMerges += state.merges;
    const isNewBest = state.score > store.bestScore;
    if (isNewBest) store.bestScore = state.score;
    if (state.maxCombo > store.maxCombo) store.maxCombo = state.maxCombo;
    store.kingCakeCount += state.kingCakes;
    Storage.save(store);

    document.getElementById('ui-best').textContent = store.bestScore.toLocaleString();
    document.getElementById('ui-final-rank').textContent = resolveRank(state.score);
    document.getElementById('stat-merges').textContent = state.merges;
    document.getElementById('stat-combo').textContent = state.maxCombo;
    document.getElementById('stat-king').textContent = state.kingCakes;
    const bestNote = document.querySelector('.result-best-note');
    if (bestNote) {
      bestNote.textContent = isNewBest && state.score > 0
        ? '🎉 최고 기록 갱신!'
        : `BEST ${store.bestScore.toLocaleString()}`;
    }
    if (window.Audio2) Audio2.playGameOver();
    // 광고 부활 버튼 활성/비활성 (1게임 1회)
    const reviveBtn = document.getElementById('btn-revive');
    if (reviveBtn) {
      reviveBtn.disabled = state.reviveUsed;
      reviveBtn.querySelector('.revive-note').textContent = state.reviveUsed
        ? '(이미 사용했어요)'
        : '(1게임 1회 · 디저트 3개 부수기)';
    }
    setTimeout(() => {
      openModal('gameover-modal');
      animateFinalScore(state.score);
    }, 600);
  }

  // ==========================================
  // 광고 → 망치 부활
  // ==========================================
  const AD_DURATION_MS = 6000;
  const AD_SLIDES = 4;
  let adTimer = null;

  function startAd() {
    if (state.reviveUsed) return;
    closeModal('gameover-modal');
    if (window.Audio2) { Audio2.unlock(); Audio2.playAdBell(); }

    const slides = document.querySelectorAll('#ad-slides .ad-slide');
    const timerEl = document.getElementById('ad-timer');
    const fillEl = document.getElementById('ad-progress-fill');
    slides.forEach((s, i) => s.classList.toggle('active', i === 0));
    timerEl.textContent = (AD_DURATION_MS / 1000).toFixed(0);
    fillEl.style.width = '0%';

    openModal('ad-modal');

    const start = performance.now();
    let lastSlide = 0;
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(() => {
      const elapsed = performance.now() - start;
      const ratio = Math.min(1, elapsed / AD_DURATION_MS);
      fillEl.style.width = (ratio * 100) + '%';
      const remaining = Math.max(0, AD_DURATION_MS - elapsed);
      timerEl.textContent = Math.ceil(remaining / 1000).toString();
      // 슬라이드 전환
      const slideIdx = Math.min(AD_SLIDES - 1, Math.floor(ratio * AD_SLIDES));
      if (slideIdx !== lastSlide) {
        slides.forEach((s, i) => s.classList.toggle('active', i === slideIdx));
        lastSlide = slideIdx;
      }
      if (ratio >= 1) {
        clearInterval(adTimer);
        adTimer = null;
        finishAd();
      }
    }, 80);
  }

  function finishAd() {
    closeModal('ad-modal');
    enterHammerMode();
  }

  function enterHammerMode() {
    state.reviveUsed = true;
    state.hammerMode = true;
    // 통에 있는 동적 디저트 수에 맞춰 max 3개
    const avail = Physics.getDynamicBodies().length;
    state.hammerRemaining = Math.min(3, avail);
    if (state.hammerRemaining <= 0) {
      // 부술 디저트가 없으면 바로 게임 재개
      finishHammerMode();
      return;
    }
    document.getElementById('game-screen')?.classList.add('hammer-mode');
    const banner = document.getElementById('hammer-banner');
    document.getElementById('hammer-remaining').textContent = state.hammerRemaining.toString();
    banner?.classList.add('show');
    if (window.Audio2) Audio2.playHammerReady();
    // 게임오버 시 unbindInputs 됐으니 다시 등록 — 망치 클릭 받기
    unbindInputs(); // 중복 등록 방지
    bindInputs();
    state.running = true;
    state.lastFrame = performance.now();
    scheduleNextFrame();
  }

  function hammerSmashAt(canvasX, canvasY) {
    if (!state.hammerMode || state.hammerRemaining <= 0) return;
    const removed = Physics.removeBodyAt(canvasX, canvasY, 50);
    if (!removed) return;
    state.hammerRemaining--;
    document.getElementById('hammer-remaining').textContent = state.hammerRemaining.toString();
    const banner = document.getElementById('hammer-banner');
    banner?.classList.remove('bump');
    void banner?.offsetWidth;
    banner?.classList.add('bump');
    Render.spawnMergeParticles(removed.x, removed.y, '#FFD86B', 22);
    if (window.Audio2) Audio2.playSmash();
    if (state.hammerRemaining <= 0) {
      setTimeout(finishHammerMode, 350);
    }
  }

  function finishHammerMode() {
    state.hammerMode = false;
    document.getElementById('game-screen')?.classList.remove('hammer-mode');
    document.getElementById('hammer-banner')?.classList.remove('show');
    Physics.resumeAfterGameOver();
    // 게임 정상화 — 새 NEXT
    state.cooldown = 0;
    if (!state.pendingBody) spawnPending();
  }

  function maybeUpdateBestLive() {
    if (!store) return;
    if (state.score > store.bestScore) {
      store.bestScore = state.score;
      const bestEl = document.getElementById('ui-best');
      bestEl.textContent = store.bestScore.toLocaleString();
      bestEl.classList.remove('bump');
      // reflow로 애니메이션 재시작
      void bestEl.offsetWidth;
      bestEl.classList.add('bump');
      Storage.save(store);
    }
  }

  // ==========================================
  // 메인 루프
  // ==========================================
  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(50, now - state.lastFrame);
    state.lastFrame = now;
    state.t += dt;

    if (!Physics.isPaused) {
      // 물리 step 직접 호출 — matter.js Runner의 RAF 의존 우회
      Physics.step(dt);
      Physics.tickDangerCheck(dt);
      if (state.cooldown > 0) state.cooldown -= dt;
      if (!state.pendingBody && state.cooldown <= 0 && !Physics.isOver) {
        spawnPending();
      }
      if (state.pendingBody) {
        Physics.moveStaticDessert(state.pendingBody, state.dropX);
      }
      // 위험선 경고음 — 가끔만
      state.dangerToneCooldown -= dt;
      if (Physics.isAnyOverDanger() && state.dangerToneCooldown <= 0) {
        if (window.Audio2) Audio2.playDanger();
        state.dangerToneCooldown = 700;
      }
      // 점수 카운트업
      tickDisplayScore(dt);
    }

    Render.render({
      t: state.t,
      dropX: state.pendingBody ? state.dropX : null,
      pendingBody: state.pendingBody,
    });
    scheduleNextFrame();
  }

  // ==========================================
  // 입력
  // ==========================================
  function clampDropX(x) {
    if (!state.pendingBody) return x;
    const r = Desserts.getDessert(state.pendingBody.dessertId).radius;
    return Math.max(r + 2, Math.min(Physics.W - r - 2, x));
  }
  function canvasXFromEvent(e, touch) {
    const canvas = document.getElementById('game-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = touch ? touch.clientX : e.clientX;
    return ((clientX - rect.left) / rect.width) * Physics.W;
  }

  function canvasCoords(e, touch) {
    const canvas = document.getElementById('game-canvas');
    const rect = canvas.getBoundingClientRect();
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * Physics.W,
      y: ((clientY - rect.top) / rect.height) * Physics.H,
    };
  }

  function onMouseMove(e) {
    if (state.hammerMode) return;
    state.dropX = clampDropX(canvasXFromEvent(e));
  }
  function onClick(e) {
    if (window.Audio2) Audio2.unlock();
    if (state.hammerMode) {
      const p = canvasCoords(e);
      hammerSmashAt(p.x, p.y);
      return;
    }
    state.dropX = clampDropX(canvasXFromEvent(e));
    dropPending();
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (state.hammerMode) return;
    if (!e.touches[0]) return;
    state.dropX = clampDropX(canvasXFromEvent(e, e.touches[0]));
  }
  function onTouchStart(e) {
    if (window.Audio2) Audio2.unlock();
    if (!e.touches[0]) return;
    if (state.hammerMode) {
      const p = canvasCoords(e, e.touches[0]);
      hammerSmashAt(p.x, p.y);
      return;
    }
    state.dropX = clampDropX(canvasXFromEvent(e, e.touches[0]));
  }
  function onTouchEnd() {
    if (state.hammerMode) return;
    dropPending();
  }
  function onKeyDown(e) {
    if (state.hammerMode) return; // 망치 모드에선 키보드 입력 차단
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); dropPending(); }
    else if (e.key === 'ArrowLeft') state.dropX = clampDropX(state.dropX - 14);
    else if (e.key === 'ArrowRight') state.dropX = clampDropX(state.dropX + 14);
    else if (e.key === 'p' || e.key === 'P') openModalWrapped('pause-modal');
  }

  function bindInputs() {
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    window.addEventListener('keydown', onKeyDown);
  }
  function unbindInputs() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('keydown', onKeyDown);
  }

  // ==========================================
  // UI
  // ==========================================
  function updateScoreUI(instant = false) {
    if (instant) {
      state.displayScore = state.score;
      const el = document.getElementById('ui-score');
      el.textContent = state.score.toLocaleString();
    } else {
      // 살짝 통통 — 실제 숫자는 tickDisplayScore가 보간
      const el = document.getElementById('ui-score');
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }
  function tickDisplayScore() {
    if (state.displayScore === state.score) return;
    const diff = state.score - state.displayScore;
    const step = Math.max(1, Math.ceil(Math.abs(diff) / 6));
    state.displayScore += diff > 0 ? Math.min(step, diff) : Math.max(-step, diff);
    document.getElementById('ui-score').textContent = state.displayScore.toLocaleString();
  }
  function updateComboUI() {
    const tag = document.getElementById('ui-combo-tag');
    if (!tag) return;
    if (state.combo >= 2) {
      tag.textContent = `Combo x${state.combo} (×${state.comboMultiplier})`;
      tag.style.display = '';
    } else {
      tag.style.display = 'none';
    }
  }
  function updateNextPreview() {
    const box = document.getElementById('ui-next-preview');
    if (!box) return;
    const d = Desserts.getDessert(state.nextId);
    box.innerHTML = `<svg viewBox="0 0 100 100"><use href="#${d.symbolId}"/></svg>`;
  }

  function showComboToast(combo, mult) {
    const el = document.getElementById('ui-combo-toast');
    if (!el) return;
    el.textContent = `콤보 x${combo}! ×${mult}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
  function showKingToast() {
    const el = document.getElementById('ui-king-toast');
    if (!el) return;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  function animateFinalScore(target) {
    const el = document.getElementById('ui-final-score');
    if (!el) return;
    const dur = 800;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(target * eased);
      el.textContent = v.toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
    requestAnimationFrame(step);
  }

  function resolveRank(score) {
    if (score >= 8000) return '⭐ 전설의 슈가 셰프';
    if (score >= 5000) return '👑 디저트 마스터';
    if (score >= 2800) return '🎂 케이크 장인';
    if (score >= 1400) return '🧁 동네 파티시에';
    if (score >= 700) return '🍩 베이커리 알바생';
    if (score >= 300) return '🍓 디저트 입문자';
    return '🥄 모찌 견습생';
  }

  // ==========================================
  // 사운드 토글
  // ==========================================
  function syncSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    if (!btn || !window.Audio2) return;
    const on = Audio2.isEnabled();
    btn.textContent = on ? '🔊' : '🔇';
    btn.classList.toggle('muted', !on);
  }
  function bindSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!window.Audio2) return;
      Audio2.unlock();
      Audio2.setEnabled(!Audio2.isEnabled());
      syncSoundToggle();
    });
  }

  // ==========================================
  // 일시정지 모달 후크
  // ==========================================
  function openModalWrapped(id) {
    if (id === 'pause-modal') Physics.setPaused(true);
    openModal(id);
  }
  function closeModalWrapped(id) {
    closeModal(id);
    if (id === 'pause-modal') Physics.setPaused(false);
  }

  // ==========================================
  // 리사이즈 + 초기화
  // ==========================================
  window.addEventListener('resize', () => {
    if (document.getElementById('game-screen')?.classList.contains('active')) {
      Render.resize();
    }
  });
  // 탭 활성화 전환 시 lastFrame 보정 — 큰 dt로 인한 점프/즉시 게임오버 방지
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.running) {
      state.lastFrame = performance.now();
    }
  });
  document.addEventListener('DOMContentLoaded', bindSoundToggle);
  // 이미 DOMContentLoaded 후에 로드됐으면 직접 호출
  if (document.readyState !== 'loading') bindSoundToggle();

  // ==========================================
  // 전역
  // ==========================================
  window.Suika = {
    switchScreen,
    openModal: openModalWrapped,
    closeModal: closeModalWrapped,
    startAd,
  };
})();
