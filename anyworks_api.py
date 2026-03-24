"""
애니웍스 주간일지 다운로드 API 서버
- engine.py의 DownloadEngine을 HTTP API로 노출
- 프론트엔드 정적 파일도 서빙 (HTTPS mixed content 우회)
- 사내PC에서 http://127.0.0.1:5050 으로 접속
"""
import os
import sys
import json
import threading
import uuid
import base64
import mimetypes
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote

from engine import DownloadEngine

# ── 경로 ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── 작업 저장소 ──
_jobs = {}
_lock = threading.Lock()

DOWNLOAD_DIR = os.environ.get("ANYWORKS_DOWNLOAD_DIR",
                              os.path.join(BASE_DIR, "downloads"))

# ── Render 서버 URL (API 프록시용) ──
RENDER_URL = os.environ.get("RENDER_URL", "")


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
    """API + 정적 파일 핸들러"""

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

    def _send_file(self, file_path):
        """정적 파일 서빙"""
        try:
            with open(file_path, "rb") as f:
                data = f.read()
            mime, _ = mimetypes.guess_type(file_path)
            if mime is None:
                mime = "application/octet-stream"
            # HTML/JS는 UTF-8
            if mime in ("text/html", "application/javascript", "text/javascript", "text/css"):
                mime += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"404 Not Found")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self):
        self._send_json(200, {})

    def do_GET(self):
        path = unquote(self.path.split("?")[0])

        # ── API 엔드포인트 ──
        if path == "/health":
            self._send_json(200, {"status": "ok", "service": "anyworks-api"})
            return

        if path.startswith("/jobs/"):
            job_id = path.split("/jobs/")[1].split("?")[0]
            with _lock:
                job = _jobs.get(job_id)
            if not job:
                self._send_json(404, {"error": "JOB_NOT_FOUND"})
                return
            resp = {k: v for k, v in job.items() if k != "engine"}
            self._send_json(200, resp)
            return

        # ── 정적 파일 서빙 ──
        # / → 업무일지_분석기.html
        if path == "/" or path == "":
            self._send_file(os.path.join(BASE_DIR, "업무일지_분석기.html"))
            return

        # .html, .js, .css 등 프론트엔드 파일
        # 보안: BASE_DIR 밖의 파일 접근 차단
        requested = os.path.normpath(os.path.join(BASE_DIR, path.lstrip("/")))
        if not requested.startswith(os.path.normpath(BASE_DIR)):
            self.send_response(403)
            self.end_headers()
            return

        if os.path.isfile(requested):
            self._send_file(requested)
            return

        # 파일 못 찾으면 SPA 폴백 → 메인 HTML
        self._send_file(os.path.join(BASE_DIR, "업무일지_분석기.html"))

    def do_POST(self):
        # POST /download
        if self.path == "/download":
            body = self._read_body()

            required = ["username", "password", "start_date", "end_date", "teams"]
            missing = [f for f in required if not body.get(f)]
            if missing:
                self._send_json(400, {"error": "MISSING_FIELDS", "fields": missing})
                return

            config = {
                "username": body["username"],
                "password": body["password"],
                "base_url": body.get("base_url", "https://works.animotion.co.kr"),
                "list_url": body.get("list_url",
                    "https://works.animotion.co.kr/Sales/Week_List.asp?top_id=80&mun=6&table=WeekList"),
                "teams": body["teams"],
                "start_date": body["start_date"],
                "end_date": body["end_date"],
                "download_dir": "",
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
        sys.stderr.write("[anyworks-api] %s\n" % (format % args))


def main():
    port = int(os.environ.get("ANYWORKS_API_PORT", 5050))
    server = HTTPServer(("0.0.0.0", port), AnyworksHandler)
    print(f"[anyworks-api] http://0.0.0.0:{port} 에서 시작")
    print(f"")
    print(f"  ▶ 사내PC 브라우저에서 접속: http://127.0.0.1:{port}")
    print(f"  ▶ 애니웍스 가져오기 → 사내PC 모드로 자동 연결")
    print(f"")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[anyworks-api] 종료")
        server.server_close()


if __name__ == "__main__":
    main()
