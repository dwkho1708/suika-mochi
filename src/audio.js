// 사운드 — Web Audio API로 합성 (외부 에셋 X)
// 기획서 §7 사운드/피드백. 합치기는 반음씩 올라가는 음정으로 단계 표현.

(() => {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let enabled = true;

  // BGM 관련 상태 및 듀얼 채널 크로스페이드 엔진
  let bgm1 = null;
  let bgm2 = null;
  let activeBgm = null;
  let bgmInterval = null;
  let bgmPlaying = false;
  const BGM_SRC = './assets/Sunday_Paper.mp4';
  const BGM_VOLUME = 0.22; // BGM 기본 볼륨 (효과음보다 약간 작게)
  const FADE_TIME = 2000;  // 2초간 부드러운 크로스페이드

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.35;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  function resumeIfSuspended() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function setEnabled(on) {
    enabled = !!on;
    if (masterGain) masterGain.gain.value = on ? 0.35 : 0;
    
    // BGM 볼륨 동기화
    if (on) {
      if (bgmPlaying) {
        if (activeBgm) activeBgm.volume = BGM_VOLUME;
      } else {
        startBGM();
      }
    } else {
      if (bgm1) bgm1.volume = 0;
      if (bgm2) bgm2.volume = 0;
    }
  }
  function isEnabled() { return enabled; }

  // 부드러운 톤 — sine + 감쇠 envelope
  function tone(freq, dur, { type = 'sine', vol = 0.5, attack = 0.005, release = 0.18, slideTo = null } = {}) {
    if (!enabled) return;
    if (!ensureCtx()) return;
    resumeIfSuspended();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // 짧은 노이즈 — "톡" 같은 클릭에 사용
  function noise(dur, { vol = 0.3, hp = 800 } = {}) {
    if (!enabled) return;
    if (!ensureCtx()) return;
    resumeIfSuspended();
    const t0 = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // 합치기 "퐁" — 단계가 올라갈수록 반음씩 위로 (1.0594^level)
  function playMerge(level = 1) {
    const base = 392; // G4
    const freq = base * Math.pow(1.0594, Math.max(0, level - 1));
    tone(freq, 0.22, { type: 'sine', vol: 0.45, attack: 0.005, release: 0.2 });
    // 옥타브 위에 살짝 반짝임
    tone(freq * 2, 0.12, { type: 'triangle', vol: 0.15, attack: 0.005 });
  }

  function playDrop() {
    noise(0.04, { vol: 0.18, hp: 1200 });
    tone(180, 0.08, { type: 'sine', vol: 0.18, slideTo: 110 });
  }

  function playCombo(combo = 2) {
    const base = 660 + combo * 60;
    tone(base, 0.12, { type: 'triangle', vol: 0.35 });
    setTimeout(() => tone(base * 1.25, 0.16, { type: 'triangle', vol: 0.3 }), 90);
  }

  function playDanger() {
    tone(880, 0.15, { type: 'square', vol: 0.18 });
  }

  function playGameOver() {
    const seq = [523, 440, 349, 262]; // C5 → A4 → F4 → C4
    seq.forEach((f, i) => setTimeout(() => tone(f, 0.25, { type: 'sine', vol: 0.35, attack: 0.02 }), i * 140));
  }

  // 3단 케이크 팡파레
  function playKing() {
    const seq = [523, 659, 784, 1047]; // C5 - E5 - G5 - C6
    seq.forEach((f, i) => setTimeout(() => {
      tone(f, 0.3, { type: 'triangle', vol: 0.4, attack: 0.01 });
      tone(f * 2, 0.2, { type: 'sine', vol: 0.15 });
    }, i * 110));
  }

  // 망치로 디저트 부수기 — 둔탁한 "쾅!"
  function playSmash() {
    noise(0.12, { vol: 0.4, hp: 200 });
    tone(80, 0.18, { type: 'sine', vol: 0.45, slideTo: 40 });
    setTimeout(() => tone(220, 0.08, { type: 'triangle', vol: 0.2 }), 30);
  }

  // 광고 시작 알림 "딩동~"
  function playAdBell() {
    tone(880, 0.12, { type: 'sine', vol: 0.3 });
    setTimeout(() => tone(660, 0.18, { type: 'sine', vol: 0.3 }), 110);
  }

  // 망치 모드 시작 "두구두구!" 살짝 긴장감
  function playHammerReady() {
    tone(440, 0.15, { type: 'triangle', vol: 0.3 });
    setTimeout(() => tone(554, 0.15, { type: 'triangle', vol: 0.3 }), 130);
    setTimeout(() => tone(880, 0.3, { type: 'triangle', vol: 0.4 }), 260);
  }

  // ==========================================
  // BGM 듀얼 채널 크로스페이드 루프 구현
  // ==========================================
  function initBGM() {
    if (bgm1) return;
    bgm1 = new Audio(BGM_SRC);
    bgm2 = new Audio(BGM_SRC);
    bgm1.preload = 'auto';
    bgm2.preload = 'auto';
    bgm1.crossOrigin = 'anonymous';
    bgm2.crossOrigin = 'anonymous';
  }

  function startBGM() {
    initBGM();
    if (!enabled || bgmPlaying) return;
    bgmPlaying = true;

    activeBgm = bgm1;
    activeBgm.volume = BGM_VOLUME;
    activeBgm.currentTime = 0;

    playAudio(activeBgm);
    startBgmMonitor();
  }

  function playAudio(audio) {
    const p = audio.play();
    if (p !== undefined) {
      p.catch(e => console.warn('[Audio2] BGM 재생 대기 (인터랙션 필요):', e));
    }
  }

  function startBgmMonitor() {
    if (bgmInterval) clearInterval(bgmInterval);
    bgmInterval = setInterval(() => {
      if (!bgmPlaying || !activeBgm) return;

      const dur = activeBgm.duration;
      const curr = activeBgm.currentTime;

      // 30초 음악이 끝나기 FADE_TIME (2초) 전에 다음 교차 트랙 재생 트리거
      if (dur && dur > 0 && curr >= dur - (FADE_TIME / 1000)) {
        crossfade();
      }
    }, 100);
  }

  function crossfade() {
    const nextBgm = activeBgm === bgm1 ? bgm2 : bgm1;
    const prevBgm = activeBgm;

    nextBgm.currentTime = 0;
    nextBgm.volume = 0;
    playAudio(nextBgm);

    activeBgm = nextBgm;

    // 2초(FADE_TIME)간 볼륨 교차 전환
    const steps = 20;
    const intervalTime = FADE_TIME / steps;
    let currentStep = 0;

    const fadeTimer = setInterval(() => {
      currentStep++;
      const ratio = currentStep / steps;

      if (!enabled) {
        prevBgm.volume = 0;
        nextBgm.volume = 0;
        clearInterval(fadeTimer);
        return;
      }

      prevBgm.volume = BGM_VOLUME * (1 - ratio);
      nextBgm.volume = BGM_VOLUME * ratio;

      if (currentStep >= steps) {
        prevBgm.pause();
        prevBgm.currentTime = 0;
        clearInterval(fadeTimer);
      }
    }, intervalTime);
  }

  function stopBGM() {
    bgmPlaying = false;
    if (bgmInterval) clearInterval(bgmInterval);
    if (bgm1) { bgm1.pause(); bgm1.currentTime = 0; }
    if (bgm2) { bgm2.pause(); bgm2.currentTime = 0; }
    activeBgm = null;
  }

  window.Audio2 = {
    setEnabled, isEnabled,
    playMerge, playDrop, playCombo, playDanger, playGameOver, playKing,
    playSmash, playAdBell, playHammerReady,
    startBGM, stopBGM,
    // 첫 사용자 인터랙션에서 컨텍스트 만들기 및 BGM 재생 시작
    unlock: () => { 
      ensureCtx(); 
      resumeIfSuspended(); 
      startBGM();
    },
  };
})();
