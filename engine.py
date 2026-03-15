"""
주간일지 다운로드 엔진
- GUI / CLI 모두에서 사용 가능
- log_callback으로 로그를 외부에 전달
"""
import os
import time
import glob
import shutil
import traceback
from datetime import datetime, timedelta

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from webdriver_manager.chrome import ChromeDriverManager


# 엑셀 파일 확장자
EXCEL_EXTS = ("*.xls", "*.xlsx", "*.csv")


class DownloadEngine:
    """주간일지 자동 다운로드 엔진"""

    def __init__(self, config, log_callback=None):
        """
        config: dict with keys:
            username, password, base_url, list_url,
            teams (list), start_date (str YYYYMMDD), end_date (str YYYYMMDD),
            download_dir (str path),
            download_timeout (int), page_load_timeout (int)
        log_callback: callable(msg: str, level: str) — 로그 수신 함수
        """
        self.config = config
        self._log_cb = log_callback or (lambda msg, level: None)
        self._cancelled = False
        self.driver = None

        self.download_dir = config["download_dir"]
        os.makedirs(self.download_dir, exist_ok=True)

        # 감시 폴더
        self.watch_dirs = [d for d in [
            self.download_dir,
            os.path.expanduser("~/Downloads"),
            os.path.expanduser("~/다운로드"),
        ] if os.path.exists(d)]

        # 로그 파일
        log_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.log_path = os.path.join(self.download_dir, f"download_log_{log_ts}.txt")
        self._log_file = open(self.log_path, "w", encoding="utf-8")

    # ── 로그 ──
    def log(self, msg, level="INFO"):
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        line = f"[{ts}] [{level}] {msg}"
        # 파일에 기록
        self._log_file.write(line + "\n")
        self._log_file.flush()
        # 콜백 (GUI 등)
        self._log_cb(line, level)

    def log_error(self, msg, exc=None):
        self.log(msg, "ERROR")
        if exc:
            for line in traceback.format_exception(type(exc), exc, exc.__traceback__):
                for sub in line.rstrip().split("\n"):
                    self.log(f"  {sub}", "ERROR")

    # ── 취소 ──
    def cancel(self):
        self._cancelled = True
        self.log("사용자 취소 요청", "WARN")

    def _check_cancel(self):
        if self._cancelled:
            raise CancelledError("사용자가 취소했습니다")

    # ── 유틸 ──
    def _wait_page_ready(self, timeout=None):
        timeout = timeout or self.config.get("page_load_timeout", 10)
        WebDriverWait(self.driver, timeout).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )

    def _set_date_field(self, field_id, date_value):
        self.driver.execute_script(f"""
            var el = document.getElementById('{field_id}');
            if (!el) return;
            el.removeAttribute('readonly');
            el.removeAttribute('disabled');
            el.value = '{date_value}';
            el.dispatchEvent(new Event('change', {{ bubbles: true }}));
        """)

    def _scan_files(self, directory):
        files = set()
        for ext in EXCEL_EXTS:
            files |= set(glob.glob(os.path.join(directory, ext)))
        return files

    def _snapshot_watch_dirs(self):
        return {d: self._scan_files(d) for d in self.watch_dirs}

    def _find_new_download(self, snapshot_before, timeout=None):
        timeout = timeout or self.config.get("download_timeout", 15)
        end_time = time.time() + timeout
        while time.time() < end_time:
            self._check_cancel()
            for d in self.watch_dirs:
                if glob.glob(os.path.join(d, "*.crdownload")) or \
                   glob.glob(os.path.join(d, "*.tmp")):
                    continue
                new_files = self._scan_files(d) - snapshot_before.get(d, set())
                if new_files:
                    return max(new_files, key=os.path.getctime)
            time.sleep(0.3)
        return None

    def _make_filename(self, team_name, ext):
        now = datetime.now()
        ts = now.strftime("%Y%m%d_%H%M%S") + f"{now.microsecond // 1000:03d}"
        sd = self.config["start_date"]
        ed = self.config["end_date"]
        return f"주간일지_{team_name}_{sd}_{ed}_{ts}{ext}"

    def _click_with_js_fallback(self, css_selector, js_function, label):
        try:
            btn = WebDriverWait(self.driver, 3).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, css_selector))
            )
            btn.click()
            self.log(f"  {label} 버튼 클릭")
            return True
        except Exception:
            self.log(f"  {label} 버튼 못 찾음 → JS {js_function} 호출", "WARN")
            try:
                self.driver.execute_script(f"{js_function};")
                return True
            except Exception as e2:
                self.log_error(f"  {js_function} 호출 실패", e2)
                return False

    def _handle_new_windows(self, windows_before):
        new_windows = set(self.driver.window_handles) - windows_before
        if not new_windows:
            return
        current_window = list(windows_before)[0]
        self.log(f"  새 창 {len(new_windows)}개 처리")
        for handle in new_windows:
            self.driver.switch_to.window(handle)
            self.log(f"  새 창 URL: {self.driver.current_url}")
            time.sleep(1)
            try:
                self.driver.close()
            except Exception as e:
                self.log(f"  새 창 닫기 실패: {e}", "WARN")
        self.driver.switch_to.window(current_window)
        iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
        if iframes:
            self.driver.switch_to.frame(iframes[0])

    # ── 브라우저 조작 ──
    def _create_driver(self):
        options = Options()
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--window-size=1920,1080")
        prefs = {
            "download.default_directory": self.download_dir,
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "safebrowsing.enabled": True,
            "profile.default_content_settings.popups": 0,
            "profile.default_content_setting_values.automatic_downloads": 1,
        }
        options.add_experimental_option("prefs", prefs)
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        driver.execute_cdp_cmd("Page.setDownloadBehavior", {
            "behavior": "allow",
            "downloadPath": self.download_dir,
        })
        return driver

    def _login(self, wait):
        self.log("로그인 페이지 접속...")
        self.driver.get(self.config["base_url"])
        self._wait_page_ready()
        self._check_cancel()

        try:
            uid = wait.until(EC.presence_of_element_located(
                (By.CSS_SELECTOR,
                 "input[type='text'][name*='id'], "
                 "input[type='text'][name*='user'], "
                 "input[type='text'][id*='id'], "
                 "input[type='text'][placeholder*='아이디']")
            ))
        except Exception as e:
            self.log_error("아이디 입력 필드 못 찾음", e)
            return False

        uid.send_keys(self.config["username"])
        self.driver.find_element(By.CSS_SELECTOR, "input[type='password']").send_keys(
            self.config["password"]
        )
        self.log("아이디/비밀번호 입력 완료")

        try:
            btn = wait.until(EC.element_to_be_clickable(
                (By.CSS_SELECTOR,
                 "body > div.container > div.main > div.login-container > form > button")
            ))
            btn.click()
            self.log("로그인 버튼 클릭")
        except Exception as e:
            self.log_error("로그인 버튼 못 찾음", e)
            return False

        try:
            wait.until(lambda d: "Main3.asp" in d.current_url or "main" in d.current_url.lower())
            self.log(f"로그인 성공 → {self.driver.current_url}")
            return True
        except Exception as e:
            self.log_error("메인 페이지 도달 실패", e)
            return False

    def _navigate_to_list(self, wait):
        self.log("주간일지 페이지 이동 (iframe src 교체)...")
        self.driver.switch_to.default_content()
        list_url = self.config["list_url"]
        self.driver.execute_script(f"""
            var iframes = document.getElementsByTagName('iframe');
            if (iframes.length > 0) iframes[0].src = '{list_url}';
        """)
        time.sleep(2)
        self._check_cancel()

        iframes = self.driver.find_elements(By.TAG_NAME, "iframe")
        if not iframes:
            self.log_error("Main3.asp에 iframe 없음")
            return False

        self.driver.switch_to.frame(iframes[0])
        self._wait_page_ready()

        try:
            WebDriverWait(self.driver, 8).until(
                EC.presence_of_element_located((By.NAME, "TeamName"))
            )
            self.log("주간일지 페이지 로드 성공")
            return True
        except Exception as e:
            self.log_error("TeamName 드롭다운 미발견", e)
            return False

    def _search_team(self, team_name):
        self._check_cancel()
        try:
            team_select = WebDriverWait(self.driver, 5).until(
                EC.visibility_of_element_located((By.NAME, "TeamName"))
            )
            Select(team_select).select_by_visible_text(team_name)
            self.log(f"  사업부 선택: {team_name}")
        except Exception as e:
            self.log_error(f"  '{team_name}' 선택 실패", e)
            return -1

        self._set_date_field("dsc1", self.config["start_date"])
        self._set_date_field("dsc2", self.config["end_date"])
        self.log(f"  날짜: {self.config['start_date']} ~ {self.config['end_date']}")

        if not self._click_with_js_fallback(
            "input[onclick='dosearchok()']", "dosearchok()", "검색"
        ):
            return -1

        time.sleep(1)
        self._wait_page_ready()

        rows = self.driver.find_elements(By.CSS_SELECTOR, "table tbody tr")
        if not rows:
            rows = self.driver.find_elements(By.CSS_SELECTOR, "table tr")
        self.log(f"  검색 결과: {len(rows)}행")
        return len(rows)

    def _download_excel(self, team_name):
        snap = self._snapshot_watch_dirs()
        windows_before = set(self.driver.window_handles)

        if not self._click_with_js_fallback(
            "input[onclick='doExcel()']", "doExcel()", "엑셀"
        ):
            return None

        time.sleep(1)
        self._handle_new_windows(windows_before)

        self.log("  파일 감시 중...")
        t_wait = time.time()
        found = self._find_new_download(snap)
        elapsed = time.time() - t_wait

        if found:
            self.log(f"  파일 감지 ({elapsed:.1f}초): {os.path.basename(found)}")
        else:
            self.log(f"  파일 미발견 ({elapsed:.1f}초)", "WARN")
        return found

    def _process_team(self, team_name):
        self.log(f"{'─' * 40}")
        self.log(f"[{team_name}] 처리 시작")
        t_start = time.time()

        row_count = self._search_team(team_name)
        if row_count < 0:
            self.log(f"[{team_name}] 검색 실패 → 스킵")
            return False
        if row_count <= 1:
            self.log(f"[{team_name}] 데이터 없음 → 스킵")
            return False

        downloaded = self._download_excel(team_name)
        if not downloaded:
            self.log(f"[{team_name}] ⚠ 다운로드 실패 [{time.time() - t_start:.1f}초]", "WARN")
            return False

        ext = os.path.splitext(downloaded)[1]
        dest = os.path.join(self.download_dir, self._make_filename(team_name, ext))
        src_abs = os.path.abspath(downloaded)
        dest_abs = os.path.abspath(dest)
        if src_abs != dest_abs:
            shutil.move(downloaded, dest)
        size = os.path.getsize(dest)
        elapsed = time.time() - t_start
        self.log(f"[{team_name}] ✓ {os.path.basename(dest)} ({size:,} bytes) [{elapsed:.1f}초]")
        return True

    # ── 메인 실행 ──
    def run(self, selected_teams=None):
        """
        실행. selected_teams가 None이면 config의 전체 팀 사용.
        반환: dict { team_name: "✓ OK" | "⚠ SKIP/FAIL" | "✗ ERROR: ..." }
        """
        self._cancelled = False
        teams = selected_teams or self.config["teams"]
        results = {}
        t0 = time.time()

        self.log("=" * 50)
        self.log("주간일지 자동 다운로드")
        self.log(f"기간  : {self.config['start_date']} ~ {self.config['end_date']}")
        self.log(f"팀    : {', '.join(teams)}")
        self.log(f"저장  : {self.download_dir}")
        self.log(f"로그  : {self.log_path}")
        self.log("=" * 50)

        try:
            self.log("\nChrome 드라이버 초기화...")
            self.driver = self._create_driver()
            wait = WebDriverWait(self.driver, 15)
            self.log("Chrome 준비 완료")
            self._check_cancel()

            # STEP 1. 로그인
            self.log("\n[STEP 1] 로그인")
            if not self._login(wait):
                self.log("로그인 실패 — 종료", "ERROR")
                return {"_error": "로그인 실패"}

            self._check_cancel()

            # STEP 2. 페이지 이동
            self.log("\n[STEP 2] 주간일지 페이지 이동")
            if not self._navigate_to_list(wait):
                self.log("페이지 이동 실패 — 종료", "ERROR")
                return {"_error": "페이지 이동 실패"}

            self.driver.execute_cdp_cmd("Page.setDownloadBehavior", {
                "behavior": "allow",
                "downloadPath": self.download_dir,
            })

            # STEP 3. 팀별 다운로드
            self.log("\n[STEP 3] 팀별 엑셀 다운로드")
            for team in teams:
                self._check_cancel()
                try:
                    success = self._process_team(team)
                    results[team] = "✓ OK" if success else "⚠ SKIP/FAIL"
                except CancelledError:
                    results[team] = "취소됨"
                    raise
                except Exception as e:
                    self.log_error(f"[{team}] 예외 발생", e)
                    results[team] = f"✗ ERROR: {type(e).__name__}"

        except CancelledError:
            self.log("작업이 취소되었습니다.", "WARN")

        except Exception as e:
            self.log_error("전체 오류", e)

        finally:
            if self.driver:
                self.driver.quit()
                self.driver = None
                self.log("Chrome 종료")

            elapsed = time.time() - t0
            self.log(f"\n총 소요시간: {elapsed:.1f}초")
            self.log("=" * 50)

        return results

    def close(self):
        """리소스 정리"""
        if self._log_file:
            self._log_file.close()
            self._log_file = None


class CancelledError(Exception):
    pass
