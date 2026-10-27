// 임시 Postgres (E2E 용) — port 54329, db wm
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(dir, '.pgdata');
const fresh = !fs.existsSync(dataDir);
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'pw', port: 54329, persistent: true });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('wm');
console.log('PG READY');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await pg.stop(); process.exit(0); });
// Windows 에선 kill 로 신호가 전달되지 않아(강제 종료 → postgres 가 비정상 상태로 남음) 멈춤 표시 파일로 정상 종료
const stopFlag = path.join(dir, '.pgstop');
try { fs.unlinkSync(stopFlag); } catch (_) {}
setInterval(async () => {
  if (!fs.existsSync(stopFlag)) return;
  fs.unlinkSync(stopFlag);
  await pg.stop();
  console.log('PG STOPPED');
  process.exit(0);
}, 500);
