/** "Back to …": the viewer's landing page, for the shell's no-permission and not-found pages. */
import { useNavigate } from 'react-router-dom';

import { getSession, staffRoleOf } from '../data/session';
import { landingLabel, landingPath } from './nav';

export function useLanding(): { label: string; go: () => void } {
  const role = staffRoleOf(getSession().principal);
  const navigate = useNavigate();
  return {
    label: `Back to ${landingLabel(role)}`,
    go: () => navigate(landingPath(role)),
  };
}
