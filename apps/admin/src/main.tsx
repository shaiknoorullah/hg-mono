// First: an email link's token leaves the address before anything else loads (issue #329).
import './linkTokenBoot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { Root } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
