/**
 * pwa/icon.svg → PNG 아이콘들 (휴대폰 앱 · PC 앱 · 트레이)
 *   node desktop/scripts/make-icons.js   (server/node_modules 의 puppeteer 를 씀)
 */
var path = require('path'), fs = require('fs');
var root = path.join(__dirname, '..', '..');
var puppeteer = require(path.join(root, 'server', 'node_modules', 'puppeteer'));
var SVG = {}; function svgOf(n) { return SVG[n] || (SVG[n] = fs.readFileSync(path.join(root, 'pwa', n), 'utf8')); }   // v13.454 파일마다 다른 원본 (maskable · badge)
var OUT = [
  // [파일, 크기, 안쪽 여백 비율(maskable 은 안전 영역 80%), 배경]
  ['pwa/icons/icon-192.png', 192, 0],
  ['pwa/icons/icon-512.png', 512, 0],
  ['pwa/icons/maskable-512.png', 512, 0, null, 'icon-maskable.svg'],
  ['pwa/icons/apple-touch-icon.png', 180, 0, null, 'icon-maskable.svg'],   // 아이폰은 모서리를 스스로 둥글게 깎음 — 꽉 찬 바탕
  ['pwa/icons/badge-72.png', 72, 0, null, 'icon-badge.svg'],
  ['desktop/build/icon.png', 512, 0],
  ['desktop/build/tray.png', 32, 0],
  ['desktop/build/tray@2x.png', 64, 0]
];
(async function () {
  var b = await puppeteer.launch({ headless: 'shell', pipe: true, args: ['--no-sandbox'], userDataDir: require('os').tmpdir() + '/wm-icons-' + Date.now() });
  var p = await b.newPage();
  for (var i = 0; i < OUT.length; i++) {
    var o = OUT[i], s = o[1], pad = Math.round(s * o[2]);
    await p.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
    await p.setContent('<html><body style="margin:0;background:' + (o[3] || 'transparent') + '"><div style="width:' + s + 'px;height:' + s + 'px;box-sizing:border-box;padding:' + pad + 'px">' +
      svgOf(o[4] || 'icon.svg').replace('<svg ', '<svg width="' + (s - pad * 2) + '" height="' + (s - pad * 2) + '" ') + '</div></body></html>');
    await p.screenshot({ path: path.join(root, o[0]), omitBackground: !o[3], clip: { x: 0, y: 0, width: s, height: s } });
    console.log('✓', o[0]);
  }
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
