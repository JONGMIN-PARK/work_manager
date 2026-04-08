import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export var metadata = { title: 'Work Manager', description: '업무 관리 플랫폼' };

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
