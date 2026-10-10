// First: an email link's token leaves the address before anything else loads (issue #329).
import './linkTokenBoot';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Root } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

// The redesign (#89) mounts only when VITE_HG_REDESIGN is on. The check is on the
// build-time constant itself, so with the flag off Vite drops the redesign chunk entirely
// and release builds run the legacy app unchanged (MASTER-PLAN §0.2).
const RedesignRoot =
  import.meta.env['VITE_HG_REDESIGN'] === '1' || import.meta.env['VITE_HG_REDESIGN'] === 'true'
    ? lazy(() => import('./redesign/RedesignRoot'))
    : null;

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      {RedesignRoot ? (
        <Suspense fallback={null}>
          <RedesignRoot />
        </Suspense>
      ) : (
        <Root />
      )}
    </BrowserRouter>
  </StrictMode>,
);
