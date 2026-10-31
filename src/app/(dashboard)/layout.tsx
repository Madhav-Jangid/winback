import Sidebar from '@/components/ui/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content fade-in">
        {children}
      </main>
    </div>
  );
}
