'use client';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';

var loadingStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  backgroundColor: '#0C0F1A',
  color: '#E2E8F0',
  fontSize: 16,
};

export default function DashboardLayout({ children }) {
  var { user, loading } = useAuth();
  var router = useRouter();

  useEffect(function() {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) return <div style={loadingStyle}>{'\uB85C\uB529 \uC911...'}</div>;
  if (!user) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#0C0F1A' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header />
        <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
