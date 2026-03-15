"""
애니웍스 주간일지 다운로드 API 서버
- engine.py의 DownloadEngine을 HTTP API로 노출
- Express 서버에서 프록시하여 호출
"""
import os
import sys
import json
import threading
import uuid
import base64
import traceback
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

from engine import DownloadEngine

# ── 작업 저장소 ──
_jobs = {}  # job_id -> { status, logs, results, started_at, finished_at, engine }
_lock = threading.Lock()

DOWNLOAD_DIR = os.environ.get("ANYWORKS_DOWNLOAD_DIR",
                              os.path.join(os.path.dirname(__file__), "downloads"))


def _run_job(job_id, config):
    """백그라운드에서 DownloadEngine 실행"""
    logs = []

    def log_callback(msg, level):
        with _lock:
            logs.append({"ts": datetime.now().isoformat(), "level": level, "msg": msg})

    config["download_dir"] = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(config["download_dir"], exist_ok=True)

    engine = DownloadEngine(config, log_callback=log_callback)

    with _lock:
        _jobs[job_id]["engine"] = engine
        _jobs[job_id]["status"] = "running"
        _jobs[job_id]["logs"] = logs

    try:
        results = engine.run(config.get("selected_teams"))

        # 다운로드된 파일을 base64로 수집
        files = []
        for fname in os.listdir(config["download_dir"]):
            fpath = os.path.join(config["download_dir"], fname)
            if fname.endswith((".xls", ".xlsx", ".csv")):
                with open(fpath, "rb") as f:
                    files.append({
                        "name": fname,
                        "size": os.path.getsize(fpath),
                        "base64": base64.b64encode(f.read()).decode("ascii")
                    })

        with _lock:
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["results"] = results
            _jobs[job_id]["files"] = files
            _jobs[job_id]["finished_at"] = datetime.now().isoformat()

    except Exception as e:
        with _lock:
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(e)
            _jobs[job_id]["finished_at"] = datetime.now().isoformat()
    finally:
        engine.close()


class AnyworksHandler(BaseHTTPRequestHandler):
    """간단한 JSON API 핸들러"""

    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self):
        self._send_json(200, {})

    def do_GET(self):
        # GET /health
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "service": "anyworks-api"})
            return

        # GET /jobs/<id>
        if self.path.startswith("/jobs/"):
            job_id = self.path.split("/jobs/")[1].split("?")[0]
            with _lock:
                job = _jobs.get(job_id)
            if not job:
                self._send_json(404, {"error": "JOB_NOT_FOUND"})
                return
            # 응답에서 engine 객체 제거
            resp = {k: v for k, v in job.items() if k != "engine"}
            self._send_json(200, resp)
            return

        self._send_json(404, {"error": "NOT_FOUND"})

    def do_POST(self):
        # POST /download — 다운로드 작업 시작
        if self.path == "/download":
            body = self._read_body()

            # 필수 필드 검증
            required = ["username", "password", "start_date", "end_date", "teams"]
            missing = [f for f in required if not body.get(f)]
            if missing:
                self._send_json(400, {"error": "MISSING_FIELDS", "fields": missing})
                return

            config = {
                "username": body["username"],
                "password": body["password"],
                "base_url": body.get("base_url", "http://anyworks.co.kr/login"),
                "list_url": body.get("list_url",
                    "http://anyworks.co.kr/Main3.asp?module=weeklyreport&pg=weeklyreport/weeklyreportList"),
                "teams": body["teams"],
                "start_date": body["start_date"],
                "end_date": body["end_date"],
                "download_dir": "",  # _run_job에서 설정
                "download_timeout": body.get("download_timeout", 15),
                "page_load_timeout": body.get("page_load_timeout", 10),
            }

            job_id = str(uuid.uuid4())[:8]
            with _lock:
                _jobs[job_id] = {
                    "status": "queued",
                    "logs": [],
                    "results": None,
                    "files": [],
                    "error": None,
                    "started_at": datetime.now().isoformat(),
                    "finished_at": None,
                    "engine": None,
                }

            t = threading.Thread(target=_run_job, args=(job_id, config), daemon=True)
            t.start()

            self._send_json(202, {"job_id": job_id, "status": "queued"})
            return

        # POST /cancel/<id>
        if self.path.startswith("/cancel/"):
            job_id = self.path.split("/cancel/")[1]
            with _lock:
                job = _jobs.get(job_id)
            if not job:
                self._send_json(404, {"error": "JOB_NOT_FOUND"})
                return
            engine = job.get("engine")
            if engine:
                engine.cancel()
            self._send_json(200, {"message": "취소 요청 전송"})
            return

        self._send_json(404, {"error": "NOT_FOUND"})

    def log_message(self, format, *args):
        # 서버 로그 포맷
        sys.stderr.write("[anyworks-api] %s\n" % (format % args))


def main():
    port = int(os.environ.get("ANYWORKS_API_PORT", 5050))
    server = HTTPServer(("0.0.0.0", port), AnyworksHandler)
    print(f"[anyworks-api] http://0.0.0.0:{port} 에서 시작 (로컬+네트워크)")
    print(f"[anyworks-api] 브라우저에서 http://127.0.0.1:{port}/health 로 연결 확인")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[anyworks-api] 종료")
        server.server_close()


if __name__ == "__main__":
    main()
