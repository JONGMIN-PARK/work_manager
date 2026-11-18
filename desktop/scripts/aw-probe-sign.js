// 진단용 (읽기만): approve 를 dry 로 — 날짜 → seq 찾기 · 단추/서명 상태만 본다. 승인은 누르지 않는다.
//   AW_SETTINGS=<{username,password} json> AW_DATES=2026-11-18,2026-11-17 AW_NAMES=박종민 npx electron scripts/aw-probe-sign.js
const { app } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'awprobe-')));
const aw = require('../anyworks.js');
app.whenReady().then(async () => {
  const out = (s) => process.stdout.write('PROBE ' + s + '\n');
  try {
    const j = JSON.parse(fs.readFileSync(process.env.AW_SETTINGS, 'utf8'));
    aw._test.writeCred(j.username, j.password);
    const names = (process.env.AW_NAMES || '').split(',').filter(Boolean);
    for (const date of (process.env.AW_DATES || '').split(',').filter(Boolean)) {
      try { out(date + ' ' + JSON.stringify(await aw._test.run('approve', { date, names, dry: true }))); }
      catch (e) { out(date + ' ERR ' + e.code + ' ' + e.message); }
    }
  } catch (e) { out('ERR ' + (e && (e.stack || e))); }
  aw._test.closeWin(); aw._test.clearCred(); app.quit();
});
