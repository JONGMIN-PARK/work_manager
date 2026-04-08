import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export var metadata = {
  title: 'WorkManager — 올인원 업무 관리 플랫폼',
  description: '업무일지 분석, 프로젝트 관리, 이슈 트래커, AI 요약, 텔레그램 봇. 팀의 생산성을 한 단계 끌어올리는 SaaS 플랫폼.',
  manifest: '/manifest.json',
  themeColor: '#3B82F6',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3B82F6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js');
                });
              }
              window.addEventListener('online', function() { document.body.classList.remove('offline'); });
              window.addEventListener('offline', function() { document.body.classList.add('offline'); });
              if (!navigator.onLine) document.body.classList.add('offline');
            `,
          }}
        />
      </body>
    </html>
  );
}
