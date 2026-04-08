'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

var FEATURES = [
  {
    icon: '📊',
    title: '업무일지 분석',
    desc: '엑셀 업로드 한 번으로 팀 전체의 투입 시간, 프로젝트별 현황을 자동 분석합니다.'
  },
  {
    icon: '📁',
    title: '프로젝트 관리',
    desc: '마일스톤, 진척률, 체크리스트까지. 프로젝트 전체 생명주기를 한눈에 관리합니다.'
  },
  {
    icon: '🎫',
    title: '이슈 트래커',
    desc: '긴급도별 이슈 관리, 커스텀 워크플로우, 대응 이력 추적을 지원합니다.'
  },
  {
    icon: '🤖',
    title: 'AI 요약 & 질의',
    desc: '주간/월간 리포트 자동 생성, 자연어로 데이터 질의. "이번 달 투입시간?"'
  },
  {
    icon: '💬',
    title: '텔레그램 봇',
    desc: '24개 명령어로 업무 등록, 현황 조회, 알림 수신. 어디서든 팀과 연결됩니다.'
  },
  {
    icon: '🔔',
    title: '선제적 알림',
    desc: '납기 D-7/D-3/D-1, 과부하 경고, 진척도 갭 자동 감지. 놓치는 일이 없습니다.'
  },
  {
    icon: '🔐',
    title: 'SSO & 보안',
    desc: 'SAML 2.0 SSO, RBAC, 감사 로그, GDPR 데이터 내보내기. 엔터프라이즈 보안.'
  },
  {
    icon: '🏢',
    title: '온프레미스 배포',
    desc: 'Docker Compose 원클릭 배포. 우리 서버에서 직접 운영할 수 있습니다.'
  },
];

var PLANS = [
  {
    name: 'Free',
    price: '0',
    unit: '',
    color: '#64748B',
    features: ['5명까지', '30일 데이터 보관', '기본 대시보드', '이슈 트래커'],
    cta: '무료로 시작',
    popular: false,
  },
  {
    name: 'Pro',
    price: '99,000',
    unit: '원/월',
    color: '#8B5CF6',
    features: ['20명까지', '전체 데이터 보관', 'AI 질의 100회/월', '텔레그램 봇', '업무일지 분석', '선제적 알림'],
    cta: 'Pro 시작하기',
    popular: true,
  },
  {
    name: 'Business',
    price: '249,000',
    unit: '원/월',
    color: '#3B82F6',
    features: ['50명까지', 'AI 질의 500회/월', 'API 접근', '커스텀 필드', '워크플로우 빌더', '우선 지원'],
    cta: 'Business 시작',
    popular: false,
  },
  {
    name: 'Enterprise',
    price: '협의',
    unit: '',
    color: '#F59E0B',
    features: ['무제한 사용자', '무제한 AI', 'SSO/SAML', '온프레미스 배포', '화이트라벨', '감사 대시보드', '전담 지원'],
    cta: '문의하기',
    popular: false,
  },
];

export default function LandingPage() {
  var { user, loading } = useAuth();
  var router = useRouter();
  var [scrolled, setScrolled] = useState(false);

  useEffect(function () {
    if (!loading && user) router.push('/dashboard');
  }, [user, loading, router]);

  useEffect(function () {
    function onScroll() { setScrolled(window.scrollY > 20); }
    window.addEventListener('scroll', onScroll);
    return function () { window.removeEventListener('scroll', onScroll); };
  }, []);

  if (loading) return <div style={{ minHeight: '100vh', background: '#06080F' }} />;
  if (user) return null;

  return (
    <div style={{ background: '#06080F', color: '#E2E8F0', minHeight: '100vh' }}>
      {/* ─── Nav ─── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(6,8,15,0.92)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid #1E2235' : '1px solid transparent',
        transition: 'all 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#3B82F6', fontSize: 22 }}>&#9670;</span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>WorkManager</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/login" style={s.navLink}>로그인</Link>
          <Link href="/register" style={s.navBtn}>무료로 시작</Link>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section style={s.hero}>
        <div style={s.heroBadge}>Phase 1~3 완료 &middot; v12.0 Enterprise Ready</div>
        <h1 style={s.heroTitle}>
          업무 관리의<br />
          <span style={{ color: '#3B82F6' }}>모든 것</span>을 한곳에
        </h1>
        <p style={s.heroDesc}>
          업무일지 분석, 프로젝트 관리, 이슈 트래커, AI 요약, 텔레그램 봇까지.<br />
          팀의 생산성을 한 단계 끌어올리는 올인원 업무 관리 플랫폼.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/register" style={s.heroBtn}>무료로 시작하기</Link>
          <a href="#features" style={s.heroBtnSec}>기능 살펴보기</a>
        </div>

        {/* Stats */}
        <div style={s.statsRow}>
          {[['155+', 'API 엔드포인트'], ['36+', 'DB 테이블'], ['14', '대시보드 페이지'], ['24', '텔레그램 명령어']].map(function (st) {
            return (
              <div key={st[1]} style={s.statItem}>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#3B82F6' }}>{st[0]}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{st[1]}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" style={s.section}>
        <div style={s.sectionInner}>
          <h2 style={s.sectionTitle}>강력한 기능</h2>
          <p style={s.sectionDesc}>업무 관리에 필요한 모든 기능을 하나의 플랫폼에서 제공합니다.</p>
          <div style={s.featGrid}>
            {FEATURES.map(function (f) {
              return (
                <div key={f.title} style={s.featCard}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>{f.title}</h3>
                  <p style={{ fontSize: 13, color: '#94A3B8', lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section style={{ ...s.section, background: '#0A0D17' }}>
        <div style={s.sectionInner}>
          <h2 style={s.sectionTitle}>시작은 간단합니다</h2>
          <div style={s.stepsRow}>
            {[
              { step: '1', title: '회원가입', desc: '30초면 충분합니다. Google 로그인도 지원.' },
              { step: '2', title: '조직 생성', desc: '팀 이름을 정하고 동료를 초대하세요.' },
              { step: '3', title: '업무 시작', desc: '프로젝트 생성, 이슈 등록, AI 분석까지.' },
            ].map(function (item) {
              return (
                <div key={item.step} style={s.stepCard}>
                  <div style={s.stepNum}>{item.step}</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0', margin: '12px 0 6px' }}>{item.title}</h3>
                  <p style={{ fontSize: 13, color: '#94A3B8', margin: 0, lineHeight: 1.6 }}>{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" style={s.section}>
        <div style={s.sectionInner}>
          <h2 style={s.sectionTitle}>합리적인 가격</h2>
          <p style={s.sectionDesc}>팀 규모에 맞는 플랜을 선택하세요. 언제든 업그레이드할 수 있습니다.</p>
          <div style={s.priceGrid}>
            {PLANS.map(function (plan) {
              return (
                <div key={plan.name} style={{
                  ...s.priceCard,
                  borderColor: plan.popular ? '#3B82F6' : '#1E2235',
                  position: 'relative',
                }}>
                  {plan.popular && <div style={s.popularBadge}>인기</div>}
                  <div style={{ fontSize: 14, fontWeight: 700, color: plan.color, marginBottom: 8 }}>{plan.name}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: plan.price === '협의' ? 24 : 32, fontWeight: 800, color: '#E2E8F0' }}>{plan.price}</span>
                    {plan.unit && <span style={{ fontSize: 13, color: '#64748B' }}>{plan.unit}</span>}
                  </div>
                  <ul style={s.priceFeatures}>
                    {plan.features.map(function (f) {
                      return <li key={f} style={s.priceFeatureItem}><span style={{ color: plan.color }}>&#10003;</span> {f}</li>;
                    })}
                  </ul>
                  <Link href="/register" style={{
                    ...s.priceBtn,
                    background: plan.popular ? 'linear-gradient(135deg, #3B82F6, #2563EB)' : 'transparent',
                    border: plan.popular ? 'none' : '1px solid #2A2F45',
                    color: plan.popular ? '#fff' : '#94A3B8',
                  }}>{plan.cta}</Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Enterprise CTA ─── */}
      <section style={{ ...s.section, background: '#0A0D17' }}>
        <div style={{ ...s.sectionInner, textAlign: 'center' }}>
          <h2 style={{ ...s.sectionTitle, fontSize: 28 }}>엔터프라이즈 도입을 고려하시나요?</h2>
          <p style={{ ...s.sectionDesc, maxWidth: 500, margin: '0 auto 28px' }}>
            SSO/SAML, 온프레미스 배포, 화이트라벨, 전담 지원까지.
            조직의 요구사항에 맞춘 맞춤 플랜을 제안해 드립니다.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={s.heroBtn}>데모 요청하기</Link>
            <a href="mailto:contact@workmanager.io" style={s.heroBtnSec}>이메일 문의</a>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer style={s.footer}>
        <div style={s.footerInner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ color: '#3B82F6', fontSize: 18 }}>&#9670;</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>WorkManager</span>
          </div>
          <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>
            &copy; 2026 WorkManager. All rights reserved.
          </p>
          <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 13 }}>
            <a href="#features" style={{ color: '#64748B', textDecoration: 'none' }}>기능</a>
            <a href="#pricing" style={{ color: '#64748B', textDecoration: 'none' }}>가격</a>
            <Link href="/login" style={{ color: '#64748B', textDecoration: 'none' }}>로그인</Link>
            <Link href="/register" style={{ color: '#64748B', textDecoration: 'none' }}>회원가입</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

var s = {
  // Nav
  navLink: { fontSize: 14, color: '#94A3B8', textDecoration: 'none', padding: '8px 14px', borderRadius: 8, transition: 'color 0.2s' },
  navBtn: { fontSize: 14, fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '8px 18px', borderRadius: 8, background: 'linear-gradient(135deg, #3B82F6, #2563EB)' },

  // Hero
  hero: { paddingTop: 140, paddingBottom: 80, textAlign: 'center', maxWidth: 800, margin: '0 auto', padding: '140px 24px 80px' },
  heroBadge: { display: 'inline-block', fontSize: 12, fontWeight: 600, color: '#3B82F6', padding: '6px 16px', borderRadius: 20, border: '1px solid #3B82F640', marginBottom: 24 },
  heroTitle: { fontSize: 48, fontWeight: 800, lineHeight: 1.2, letterSpacing: -1, margin: '0 0 20px', color: '#F1F5F9' },
  heroDesc: { fontSize: 16, color: '#94A3B8', lineHeight: 1.8, margin: '0 0 32px' },
  heroBtn: { display: 'inline-block', fontSize: 15, fontWeight: 600, color: '#fff', textDecoration: 'none', padding: '14px 32px', borderRadius: 10, background: 'linear-gradient(135deg, #3B82F6, #2563EB)', boxShadow: '0 4px 20px rgba(59,130,246,0.3)' },
  heroBtnSec: { display: 'inline-block', fontSize: 15, fontWeight: 500, color: '#94A3B8', textDecoration: 'none', padding: '14px 32px', borderRadius: 10, border: '1px solid #2A2F45' },

  // Stats
  statsRow: { display: 'flex', justifyContent: 'center', gap: 40, marginTop: 60, flexWrap: 'wrap' },
  statItem: { textAlign: 'center' },

  // Section
  section: { padding: '80px 24px' },
  sectionInner: { maxWidth: 1100, margin: '0 auto' },
  sectionTitle: { fontSize: 32, fontWeight: 800, textAlign: 'center', marginBottom: 12, letterSpacing: -0.5 },
  sectionDesc: { fontSize: 15, color: '#94A3B8', textAlign: 'center', marginBottom: 48, lineHeight: 1.7 },

  // Features
  featGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 },
  featCard: { background: '#0C0F1A', border: '1px solid #1E2235', borderRadius: 14, padding: '28px 24px', transition: 'border-color 0.2s' },

  // Steps
  stepsRow: { display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' },
  stepCard: { flex: '1 1 240px', maxWidth: 300, textAlign: 'center', padding: '32px 24px' },
  stepNum: { display: 'inline-flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'linear-gradient(135deg, #3B82F6, #2563EB)', color: '#fff', fontSize: 18, fontWeight: 800 },

  // Pricing
  priceGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 20, alignItems: 'start' },
  priceCard: { background: '#0C0F1A', border: '1px solid #1E2235', borderRadius: 14, padding: '28px 24px', display: 'flex', flexDirection: 'column' },
  popularBadge: { position: 'absolute', top: -10, right: 16, background: '#3B82F6', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20 },
  priceFeatures: { listStyle: 'none', padding: 0, margin: '20px 0', flex: 1 },
  priceFeatureItem: { fontSize: 13, color: '#94A3B8', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 8 },
  priceBtn: { display: 'block', textAlign: 'center', padding: '12px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none', marginTop: 8 },

  // Footer
  footer: { borderTop: '1px solid #1E2235', padding: '40px 24px' },
  footerInner: { maxWidth: 1100, margin: '0 auto', textAlign: 'center' },
};
