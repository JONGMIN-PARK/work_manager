#!/usr/bin/env node
/**
 * 등록된 모든 라우트(METHOD /path)를 출력한다.
 *   node scripts/dump-routes.js              → stdout (앱 로드 로그가 섞일 수 있음)
 *   node scripts/dump-routes.js --out f.txt  → 파일로 (앱 로드 로그와 분리)
 *   node scripts/dump-routes.js --write      → __tests__/route-inventory.snapshot.txt 갱신
 *
 * 라우트를 의도적으로 추가/삭제했다면 --write 로 스냅샷을 갱신하고 diff 를 커밋에 포함한다.
 * ROUTE_APP_DIR 로 다른 사본(예: 리팩터 전 스냅샷)의 app.js 를 지정할 수 있다.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
var path = require('path');
var fs = require('fs');
var appDir = process.env.ROUTE_APP_DIR || path.join(__dirname, '..');
var app = require(path.join(appDir, 'app'));
var listRoutes = require('../lib/route-inventory').listRoutes;

var lines = listRoutes(app, { sorted: process.argv.indexOf('--unsorted') < 0 });
var text = lines.join('\n') + '\n';
var outIdx = process.argv.indexOf('--out');
if (process.argv.indexOf('--write') >= 0) {
  var out = path.join(__dirname, '..', '__tests__', 'route-inventory.snapshot.txt');
  fs.writeFileSync(out, text);
  console.error('wrote ' + lines.length + ' routes -> ' + out);
} else if (outIdx >= 0) {
  fs.writeFileSync(process.argv[outIdx + 1], text);
} else {
  process.stdout.write(text);
}
process.exit(0);
