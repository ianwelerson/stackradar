import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { TrackingProvider } from '@/hooks/useTracking';
import { Header } from '@/components/Header';
import { ScrollToTop } from '@/components/ScrollToTop';
import { Footer } from '@/components/Footer';
import { StorageModal } from '@/components/StorageModal';
import { DirectoryPage } from '@/pages/DirectoryPage';
import { CompanyPage } from '@/pages/CompanyPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { MethodologyPage } from '@/pages/MethodologyPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { companies, totalOpenings } from '@/lib/dataset';

export function App() {
  const [storageOpen, setStorageOpen] = useState(false);
  const indexLine = `${companies.length} companies · ${totalOpenings} roles`;

  return (
    <TrackingProvider>
      <div className="min-h-screen flex flex-col">
        <ScrollToTop />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
        >
          Skip to content
        </a>
        <Header indexLine={indexLine} onOpenStorage={() => setStorageOpen(true)} />
        <div id="main" className="flex-1">
          <Routes>
            <Route path="/" element={<DirectoryPage />} />
            <Route
              path="/company/:id"
              element={<CompanyPage onOpenStorage={() => setStorageOpen(true)} />}
            />
            <Route
              path="/profile"
              element={<ProfilePage onOpenStorage={() => setStorageOpen(true)} />}
            />
            <Route path="/data" element={<MethodologyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
        <Footer />
        <StorageModal open={storageOpen} onClose={() => setStorageOpen(false)} />
      </div>
    </TrackingProvider>
  );
}
