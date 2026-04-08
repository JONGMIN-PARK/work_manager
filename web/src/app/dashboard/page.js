'use client';
import { useAuth } from '@/lib/auth-context';

var STAT_CARDS = [
  {
    icon: '\uD83D\uDCC1',
    label: '\uCD1D \uD504\uB85C\uC81D\uD2B8',
    value: 12,
    borderColor: '#3B82F6',
    bgIcon: 'rgba(59, 130, 246, 0.15)',
  },
  {
    icon: '\uD83C\uDFAB',
    label: '\uC9C4\uD589 \uC911 \uC774\uC288',
    value: 8,
    borderColor: '#F59E0B',
    bgIcon: 'rgba(245, 158, 11, 0.15)',
  },
  {
    icon: '\u23F1\uFE0F',
    label: '\uC774\uBC88 \uC8FC \uC5C5\uBB34\uC2DC\uAC04',
    value: '36h',
    borderColor: '#10B981',
    bgIcon: 'rgba(16, 185, 129, 0.15)',
  },
  {
    icon: '\uD83D\uDC65',
    label: '\uD300\uC6D0 \uC218',
    value: 5,
    borderColor: '#8B5CF6',
    bgIcon: 'rgba(139, 92, 246, 0.15)',
  },
];

var RECENT_ACTIVITIES = [
  { time: '10\uBD84 \uC804', text: '\uBC15\uC885\uBBFC\uB2D8\uC774 "ERP \uC2DC\uC2A4\uD15C \uAC1C\uBC1C" \uD504\uB85C\uC81D\uD2B8\uC5D0 \uC5C5\uBB34\uC77C\uC9C0\uB97C \uC791\uC131\uD588\uC2B5\uB2C8\uB2E4.', dot: '#3B82F6' },
  { time: '32\uBD84 \uC804', text: '\uC774\uC288 #42 "API \uC751\uB2F5 \uC9C0\uC5F0" \uC0C1\uD0DC\uAC00 \uC9C4\uD589 \uC911\uC73C\uB85C \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', dot: '#F59E0B' },
  { time: '1\uC2DC\uAC04 \uC804', text: '\uC218\uC8FC\uAC74 "2026-Q2 \uC720\uC9C0\uBCF4\uC218" \uACC4\uC57D\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', dot: '#10B981' },
  { time: '2\uC2DC\uAC04 \uC804', text: '\uC77C\uC815 "\uC8FC\uAC04 \uD68C\uC758"\uAC00 \uB0B4\uC77C\uB85C \uC608\uC815\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', dot: '#8B5CF6' },
  { time: '3\uC2DC\uAC04 \uC804', text: '\uD300\uC6D0 \uAE40\uC218\uC9C4\uB2D8\uC774 \uC0C8\uB85C \uCD08\uB300\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', dot: '#EF4444' },
];

var styles = {
  page: {
    maxWidth: 1200,
  },
  greeting: {
    fontSize: 22,
    fontWeight: 700,
    color: '#E2E8F0',
    marginBottom: 4,
  },
  subGreeting: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 28,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#141824',
    borderRadius: 12,
    padding: '20px 20px 18px',
    borderTop: '3px solid',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
  },
  cardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    flexShrink: 0,
  },
  cardLabel: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 28,
    fontWeight: 700,
    color: '#E2E8F0',
    lineHeight: 1.1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#E2E8F0',
    marginBottom: 16,
  },
  activityCard: {
    backgroundColor: '#141824',
    borderRadius: 12,
    padding: '8px 0',
    border: '1px solid #2A2F45',
  },
  activityItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 20px',
  },
  activityDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginTop: 6,
    flexShrink: 0,
  },
  activityText: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 1.5,
    flex: 1,
  },
  activityTime: {
    fontSize: 12,
    color: '#64748B',
    flexShrink: 0,
    marginTop: 1,
  },
};

export default function DashboardPage() {
  var { user } = useAuth();
  var name = user?.name || '\uC0AC\uC6A9\uC790';

  return (
    <div style={styles.page}>
      <h1 style={styles.greeting}>{'\uC548\uB155\uD558\uC138\uC694, ' + name + '\uB2D8'}</h1>
      <p style={styles.subGreeting}>{'\uC624\uB298\uC758 \uC5C5\uBB34 \uD604\uD669\uC744 \uD55C\uB208\uC5D0 \uD655\uC778\uD558\uC138\uC694.'}</p>

      {/* Stat Cards */}
      <div style={styles.grid}>
        {STAT_CARDS.map(function(card, i) {
          return (
            <div key={i} style={{ ...styles.card, borderTopColor: card.borderColor }}>
              <div style={{ ...styles.cardIconWrap, backgroundColor: card.bgIcon }}>
                {card.icon}
              </div>
              <div>
                <div style={styles.cardLabel}>{card.label}</div>
                <div style={styles.cardValue}>{card.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent Activity */}
      <h2 style={styles.sectionTitle}>{'\uCD5C\uADFC \uD65C\uB3D9'}</h2>
      <div style={styles.activityCard}>
        {RECENT_ACTIVITIES.map(function(item, i) {
          return (
            <div
              key={i}
              style={{
                ...styles.activityItem,
                borderBottom: i < RECENT_ACTIVITIES.length - 1 ? '1px solid #1E2235' : 'none',
              }}
            >
              <div style={{ ...styles.activityDot, backgroundColor: item.dot }} />
              <div style={styles.activityText}>{item.text}</div>
              <span style={styles.activityTime}>{item.time}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
