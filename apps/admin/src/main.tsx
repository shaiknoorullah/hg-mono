// First: an email link's token leaves the address before anything else loads (issue #329).
import './linkTokenBoot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { Root } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// The redesign (issue #90) is built behind a build-time flag that release builds leave off.
// Vite replaces the env read with a literal, so with the flag off this branch and the redesign's
// chunk are dropped from the bundle and the console boots exactly as before.
if (import.meta.env.VITE_HG_REDESIGN === '1' || import.meta.env.VITE_HG_REDESIGN === 'true') {
  void import('./redesign/main').then(({ mountRedesign }) => mountRedesign(container));
} else {
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
