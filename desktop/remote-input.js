/**
 * 🖱 원격 제어 입력 넣기 (v13.360) — 화면 공유 중 '허락'한 사람의 마우스 · 키보드를 이 PC 에 넣는다.
 *   네이티브 모듈 없이: 숨은 PowerShell 하나를 띄워 user32 SendInput · SetCursorPos 를 부른다 (표준 입력으로 한 줄씩 명령)
 *   좌표는 공유 중인 화면(디스플레이) 안의 비율(0~1) → 실제 화면 픽셀
 *   start() / stop() / input(ev) — main.js 가 허락 상태일 때만 부른다
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class WMI {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public U u; }
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] i, int size);
  static bool Ext(ushort vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C || vk == 0x6F || vk == 0x90; }
  public static void Key(ushort vk, bool up) { var a = new INPUT[1]; a[0].type = 1; a[0].u.ki.wVk = vk; a[0].u.ki.dwFlags = (up ? 2u : 0u) | (Ext(vk) ? 1u : 0u); SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); }
  public static void Uni(string s) { foreach (char c in s) { var a = new INPUT[2]; a[0].type = 1; a[0].u.ki.wScan = c; a[0].u.ki.dwFlags = 4; a[1].type = 1; a[1].u.ki.wScan = c; a[1].u.ki.dwFlags = 6; SendInput(2, a, Marshal.SizeOf(typeof(INPUT))); } }
}
"@
[void][WMI]::SetProcessDPIAware()
[Console]::Out.WriteLine('READY')
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = $l.Split(' ')
  switch ($p[0]) {
    'm' { [void][WMI]::SetCursorPos([int]$p[1], [int]$p[2]) }
    'b' { [void][WMI]::SetCursorPos([int]$p[2], [int]$p[3]); [WMI]::mouse_event([uint32]$p[1], 0, 0, 0, [UIntPtr]::Zero) }
    'u' { [WMI]::mouse_event([uint32]$p[1], 0, 0, 0, [UIntPtr]::Zero) }
    'w' { [WMI]::mouse_event(0x800, 0, 0, [int]$p[1], [UIntPtr]::Zero) }
    'k' { [WMI]::Key([uint16]$p[1], $p[2] -eq '1') }
    't' { [WMI]::Uni([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
    'q' { exit }
  }
}
`;

// KeyboardEvent.code → 윈도우 가상 키
const VK = { Enter: 0x0D, NumpadEnter: 0x0D, Escape: 0x1B, Backspace: 0x08, Tab: 0x09, Space: 0x20, ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  Delete: 0x2E, Insert: 0x2D, Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22, ShiftLeft: 0xA0, ShiftRight: 0xA1, ControlLeft: 0xA2, ControlRight: 0xA3,
  AltLeft: 0xA4, AltRight: 0xA5, MetaLeft: 0x5B, MetaRight: 0x5C, CapsLock: 0x14, ContextMenu: 0x5D, PrintScreen: 0x2C, Pause: 0x13, ScrollLock: 0x91, NumLock: 0x90,
  Minus: 0xBD, Equal: 0xBB, BracketLeft: 0xDB, BracketRight: 0xDD, Backslash: 0xDC, Semicolon: 0xBA, Quote: 0xDE, Comma: 0xBC, Period: 0xBE, Slash: 0xBF, Backquote: 0xC0,
  NumpadAdd: 0x6B, NumpadSubtract: 0x6D, NumpadMultiply: 0x6A, NumpadDivide: 0x6F, NumpadDecimal: 0x6E, Lang1: 0x15, Lang2: 0x19, KanaMode: 0x15 };
function vkOf(code) {
  if (!code) return 0;
  if (VK[code]) return VK[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0);
  if ((m = /^Digit([0-9])$/.exec(code))) return 0x30 + +m[1];
  if ((m = /^Numpad([0-9])$/.exec(code))) return 0x60 + +m[1];
  if ((m = /^F([0-9]{1,2})$/.exec(code))) return 0x6F + +m[1];
  return 0;
}
const BTN = { 0: [0x02, 0x04], 1: [0x20, 0x40], 2: [0x08, 0x10] };   // 왼 · 가운데 · 오른 (누름 · 뗌)

let proc = null, held = new Set();
function start() {
  if (proc || process.platform !== 'win32') return;
  const file = path.join(os.tmpdir(), 'wm-remote-input.ps1');
  fs.writeFileSync(file, '﻿' + PS, 'utf8');
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  proc.on('exit', () => { proc = null; });
  proc.stdin.on('error', () => {});
}
function send(line) { if (proc && proc.stdin.writable) proc.stdin.write(line + '\n'); }
function stop() {
  // 눌린 채 남은 키 · 버튼은 떼고 끝냄 (Ctrl 이 눌린 채 남는 사고 방지)
  held.forEach((h) => { if (h[0] === 'k') send('k ' + h.slice(1) + ' 1'); else send('u ' + BTN[h.slice(1)][1]); });
  held.clear();
  if (proc) { send('q'); const p = proc; proc = null; setTimeout(() => { try { p.kill(); } catch (_) {} }, 800); }
}
/** ev: { t: mm|md|mu|wh|kd|ku|tx, x, y (0~1), b, dy, k(code), s } · area: 공유 중인 화면 { x, y, width, height } (실제 픽셀) */
function input(ev, area) {
  if (!proc || !ev) return;
  const px = (v, o, len) => Math.round(o + Math.max(0, Math.min(1, +v || 0)) * (len - 1));
  if (ev.t === 'mm') send('m ' + px(ev.x, area.x, area.width) + ' ' + px(ev.y, area.y, area.height));
  else if (ev.t === 'md' || ev.t === 'mu') {
    const b = BTN[ev.b] ? ev.b : 0, flag = BTN[b][ev.t === 'md' ? 0 : 1];
    if (ev.t === 'md') held.add('b' + b); else held.delete('b' + b);
    send('b ' + flag + ' ' + px(ev.x, area.x, area.width) + ' ' + px(ev.y, area.y, area.height));
  } else if (ev.t === 'wh') send('w ' + (ev.dy > 0 ? 120 : -120));
  else if (ev.t === 'kd' || ev.t === 'ku') {
    const vk = vkOf(ev.k); if (!vk) return;
    if (ev.t === 'kd') held.add('k' + vk); else held.delete('k' + vk);
    send('k ' + vk + ' ' + (ev.t === 'ku' ? 1 : 0));
  } else if (ev.t === 'tx' && ev.s) send('t ' + Buffer.from(String(ev.s).slice(0, 500), 'utf8').toString('base64'));
}
module.exports = { start, stop, input, vkOf, running: () => !!proc };
