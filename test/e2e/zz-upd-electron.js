// run.sh 로 서버를 띄운 채 PC 앱 자체 업데이트 연기 시험 (desktop/scripts/upd-smoke.js)
//   desktop/release 에 잠깐 '13.496.0' (내용은 지금 설치 파일 · sha512 맞춤) 을 올렸다가 시험 뒤 원래대로
var cp = require('child_process'), path = require('path'), fs = require('fs'), crypto = require('crypto');
var REL = path.join(__dirname, '../../release/desktop');
var yml = path.join(REL, 'latest.yml'), orig = fs.readFileSync(yml, 'utf8');
var cur = (/^path:\s*(\S+)/m.exec(orig) || [])[1];
var fake = 'WorkManager-Setup-13.496.0.exe', fakePath = path.join(REL, fake);
var out = '';
try {
  fs.copyFileSync(path.join(REL, cur), fakePath);
  var buf = fs.readFileSync(fakePath);
  var sha = crypto.createHash('sha512').update(buf).digest('base64');
  fs.writeFileSync(yml, 'version: 13.496.0\nfiles:\n  - url: ' + fake + '\n    sha512: ' + sha + '\n    size: ' + buf.length + '\npath: ' + fake + '\nsha512: ' + sha + "\nreleaseDate: '" + new Date().toISOString() + "'\n");
  var r = cp.spawnSync('npx', ['electron', 'scripts/upd-smoke.js', '--server=http://localhost:3000'], { cwd: path.join(__dirname, '../../desktop'), shell: true, encoding: 'utf8', timeout: 180000 });
  out = (r.stdout || '') + (r.stderr || '');
} finally {
  fs.writeFileSync(yml, orig);
  try { fs.unlinkSync(fakePath); } catch (e) {}
}
console.log(out.split('\n').filter(function (l) { return /UPD|Error/.test(l); }).join('\n'));
console.log(/UPD OK/.test(out) ? 'ALL PASS (1)' : 'FAIL electron update');
process.exit(/UPD OK/.test(out) ? 0 : 1);
