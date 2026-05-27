// 11종 디저트 데이터 + SVG → 오프스크린 캔버스 라스터라이즈 (기획서 §6.4 / §6.8)

(() => {
  'use strict';

  const DESSERTS = [
    { id: 1,  name: '흰 모찌',       radius: 18,  mergeScore: 1,   symbolId: 'm-white' },
    { id: 2,  name: '딸기 모찌',     radius: 24,  mergeScore: 3,   symbolId: 'm-pink' },
    { id: 3,  name: '말차 모찌',     radius: 30,  mergeScore: 6,   symbolId: 'm-mint' },
    { id: 4,  name: '레몬 마카롱',   radius: 36,  mergeScore: 10,  symbolId: 'm-mac-y' },
    { id: 5,  name: '라벤더 마카롱', radius: 44,  mergeScore: 15,  symbolId: 'm-mac-l' },
    { id: 6,  name: '도넛',          radius: 52,  mergeScore: 21,  symbolId: 'm-donut' },
    { id: 7,  name: '푸딩',          radius: 60,  mergeScore: 28,  symbolId: 'm-pudding' },
    { id: 8,  name: '컵케이크',      radius: 70,  mergeScore: 36,  symbolId: 'm-cupcake' },
    { id: 9,  name: '베리 케이크',   radius: 82,  mergeScore: 50,  symbolId: 'm-mini' },
    { id: 10, name: '2단 케이크',    radius: 96,  mergeScore: 80,  symbolId: 'm-big' },
    { id: 11, name: '3단 케이크',    radius: 112, mergeScore: 130, symbolId: 'm-king' },
  ];
  const KING_BONUS = 300;
  const MAX_LEVEL = 11;

  const spriteCache = {};

  // 페이지의 <symbol>을 standalone SVG 문자열로 추출
  function buildStandaloneSvg(symbolId, size) {
    const symbol = document.getElementById(symbolId);
    if (!symbol) throw new Error(`Symbol not found: ${symbolId}`);
    const defs = document.querySelector('.svg-defs defs');
    const defsXml = defs ? new XMLSerializer().serializeToString(defs) : '';
    const inner = symbol.innerHTML;
    const viewBox = symbol.getAttribute('viewBox') || '0 0 100 100';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${defsXml}${inner}</svg>`;
  }

  function loadImage(svgString) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // 모든 디저트를 오프스크린 캔버스로 라스터라이즈 (DPR 2배)
  async function prerenderSprites() {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(2, dpr); // Retina 또렷
    await Promise.all(DESSERTS.map(async (d) => {
      const size = d.radius * 2;
      const pixelSize = size * scale;
      const svg = buildStandaloneSvg(d.symbolId, pixelSize);
      const img = await loadImage(svg);
      const off = document.createElement('canvas');
      off.width = pixelSize;
      off.height = pixelSize;
      const ctx = off.getContext('2d');
      ctx.drawImage(img, 0, 0, pixelSize, pixelSize);
      spriteCache[d.id] = { canvas: off, size, pixelSize };
    }));
  }

  function getDessert(id) { return DESSERTS[id - 1]; }
  function getSprite(id) { return spriteCache[id]; }

  window.Desserts = {
    DESSERTS,
    KING_BONUS,
    MAX_LEVEL,
    prerenderSprites,
    getDessert,
    getSprite,
  };
})();
