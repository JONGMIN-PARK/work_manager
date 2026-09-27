/* wm-state.js — 테마·폰트 적용(파싱 시점에 실행) · 주간 분석 전역 상태 · 공용 헬퍼(fD/eH/eA/pNormDate)
 * 업무일지_분석기.html 인라인 <script> 에서 분리. 동기 <script src> 로 원래 자리·순서대로 로드(defer/async 금지 — 최상위 let/function 을 다른 파일이 전역으로 공유하고, 로드 시점 코드의 의존 순서가 고정돼 있음). */
/* ═══ THEME (TH → config.js) ═══ */
let cTh='auto';
function gSysTh(){return matchMedia('(prefers-color-scheme:dark)').matches?'midnight':'light'}
function aTh(id){cTh=id;document.documentElement.setAttribute('data-theme',id==='auto'?gSysTh():id);rTh();lsSet('wa-theme',id)}
function rTh(){var bar=document.getElementById('themeBar');if(!bar)return;bar.innerHTML=TH.map(t=>`<div class="thd ${cTh===t.id?'on':''}" style="background:${t.c}" onclick="aTh('${t.id}')" title="${t.l}"><span class="dl">${t.l}</span></div>`).join('')}
var _th=lsGet('wa-theme');if(_th)cTh=_th
aTh(cTh);matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{if(cTh==='auto')aTh('auto')});

/* ═══ FONT (FONTS → config.js) — 동적 Google Fonts 로드 + body 폰트 변경 ═══ */
let cFnt='noto';
function aFnt(id){
  var FF = (typeof FONTS!=='undefined')?FONTS:[];
  var f = FF.find(function(x){return x.id===id}) || FF[0];
  if(!f) return;
  cFnt = f.id;
  // 동적 <link> 로드 (한 번만)
  if(!document.getElementById('fontLink_'+f.id)){
    var link = document.createElement('link');
    link.id = 'fontLink_'+f.id;
    link.rel = 'stylesheet';
    if(f.url){
      link.href = f.url;
    } else if(f.family){
      var primary = f.family.split(',')[0].replace(/['"]/g,'').trim();
      var w = f.weight || '400;700';
      link.href = 'https://fonts.googleapis.com/css2?family='+encodeURIComponent(primary).replace(/%20/g,'+')+':wght@'+w+'&display=swap';
    }
    document.head.appendChild(link);
  }
  document.documentElement.style.setProperty('--app-font', f.family + ',-apple-system,sans-serif');
  lsSet('wa-font', id);
  rFnt();
}
function rFnt(){
  var bar=document.getElementById('fontBar');if(!bar)return;
  var FF = (typeof FONTS!=='undefined')?FONTS:[];
  // 그룹별로 묶어서 표시 (산세리프/세리프/표제/손글씨/코드)
  var groups = {};
  var order = [];
  FF.forEach(function(f){
    var g = f.group || '기타';
    if(!groups[g]){ groups[g]=[]; order.push(g); }
    groups[g].push(f);
  });
  var html = '';
  order.forEach(function(g){
    html += '<div class="fnd-group">'+g+'</div>';
    groups[g].forEach(function(f){
      html += '<div class="fnd '+(cFnt===f.id?'on':'')+'" onclick="aFnt(\''+f.id+'\')" title="'+f.l+'" style="font-family:'+f.family.replace(/"/g,'&quot;')+'">'+f.l+'</div>';
    });
  });
  bar.innerHTML = html;
}
var _fnt=lsGet('wa-font');if(_fnt)aFnt(_fnt);else aFnt('noto');
// 폰트 메뉴 외부 클릭 시 닫기
document.addEventListener('click',function(e){
  var w=document.getElementById('fontBarWrap');
  if(w && w.classList.contains('open') && !w.contains(e.target)) w.classList.remove('open');
});

/* ═══ CONSTS: config.js에서 로드 (TH, ENC, COL, AM, ABG, AFG, ABR, CMP_COL, CMP_DASH, CMP_PT, AI_CONFIG, DIFF_KEYWORDS, AI_PRESETS) ═══ */

/* ═══ STATE ═══ */
let aD=[],aN=[],vN=[];
let sN=new Set(),sO=new Set(),sT=new Set(),sON=new Set(),sCL=new Set(),sDV=new Set();
let cKw='',cEnc='euc-kr',lBuf=null;
let excludeVac=(function(){try{return localStorage.getItem('wm_excludeVac')==='1'}catch(e){return false}})();
let selWeek=null; // 선택된 주차 {start:'YYYYMMDD', end:'YYYYMMDD', label:'...'} or null=전체
let pC=null,bC=null,tC=null,clPieC=null,clDayC=null,mtrChart=null,mtrCChart=null,mtrLineChart=null,mtrCLineChart=null;
function destroyCharts(){[pC,bC,tC,clPieC,clDayC,mtrChart,mtrCChart,mtrLineChart,mtrCLineChart].forEach(function(c){if(c){try{c.destroy()}catch(e){}}});pC=bC=tC=clPieC=clDayC=mtrChart=mtrCChart=mtrLineChart=mtrCLineChart=null;cmpPieCharts.forEach(function(c){if(c){try{c.destroy()}catch(e){}}});cmpPieCharts=[];if(cmpBarChart){try{cmpBarChart.destroy()}catch(e){}}cmpBarChart=null;if(cmpLineChart){try{cmpLineChart.destroy()}catch(e){}}cmpLineChart=null}
var _upVTimer;
function upVD(){clearTimeout(_upVTimer);_upVTimer=setTimeout(upV,30)}
let avO=[],avT=[],avON=[],avCL=[],avDV=[];
var DEPT_LIST=['장비사업부','기술연구소','모션사업부'];
let fvN=[],fvO=false;
let aiProv='anthropic'; // v13.65: 기본 Claude — 서버 응답으로 자동 갱신
let archSel=null; // selected archive id for detail
var weekYearFilter=""; // 주차 선택기 연도 필터
var weekMonthFilter=""; // 주차 선택기 월 필터 (빈 문자열=전체)
var weekQtrFilter=""; // 주차 선택기 분기 필터 (빈 문자열=전체)
var archMonthFilter=""; // 아카이브 월 필터
var trendMonthFilter=""; // 트렌드 월 필터
let trendSel=new Set(); // selected week ids for trend

function fD(d){return d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)}
/* v13.189 따옴표까지 이스케이프 — 속성값(title="…", value="…")에 들어가도 안전. 이전 DOM 방식은 " ' 를 그대로 둬 저장형 XSS 가능 */
function eH(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
/* onclick="f('…')" 용 — JS 문자열 이스케이프 + 속성 구분자(") 보호 */
function eA(s){return String(s==null?'':s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n').replace(/"/g,'&quot;')}
// HTML 테이블 파싱 (기존)
function pNormDate(v){
  if(v===undefined||v===null)return null;
  v=String(v).trim();
  if(!v)return null;
  // YYYYMMDD
  if(/^\d{8}$/.test(v))return v;
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD (시간 정보 무시)
  var m=v.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m)return m[1]+m[2].padStart(2,'0')+m[3].padStart(2,'0');
  // YY-MM-DD, YY.MM.DD, YY/MM/DD
  m=v.match(/^(\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if(m){
    var y=parseInt(m[1]);
    y+=(y<70?2000:1900);
    return String(y)+m[2].padStart(2,'0')+m[3].padStart(2,'0');
  }
  // Excel serial number
  var n=Number(v);
  if(!isNaN(n)&&n>30000&&n<70000){
    // 30000=1982-02-18, 70000=2091-10-14
    var d=new Date(Math.round((n-25569)*86400000));
    // 타임존 보정 (UTC 기준 자정 부근 날짜 뒤틀림 방지)
    if(d.getHours()>20)d.setDate(d.getDate()+1);
    return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
  }
  return null;
}
