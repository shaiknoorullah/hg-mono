import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, isSignedIn } from './lib/auth';
import { LoginPage } from './routes/LoginPage';
import { RegisterPage } from './routes/RegisterPage';
import { OnboardingPage } from './routes/onboarding/OnboardingPage';
import { OrdersPage } from './routes/OrdersPage';
import { MenuPage } from './routes/MenuPage';
import { HoursPage } from './routes/HoursPage';
import { Shell } from './components/Shell';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  if (!isSignedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/hours" element={<HoursPage />} />
        </Route>
        <Route path="*" element={<Navigate to={isSignedIn() ? '/orders' : '/login'} replace />} />
      </Routes>
    </AuthProvider>
  );
}
