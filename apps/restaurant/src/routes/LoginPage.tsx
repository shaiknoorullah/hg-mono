import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon, Input } from '@hg/ui-web';
import { useAuth } from '../lib/auth';
import { IconLock, IconMail } from '../lib/icons';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await login(email, password, needsTotp ? totp : undefined);
    setBusy(false);
    if (result.ok) {
      navigate('/onboarding', { replace: true });
      return;
    }
    if (result.mfaRequired) {
      setNeedsTotp(true);
      return;
    }
    setError(result.error ?? 'Sign-in failed.');
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="hg-fade-up w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-lg bg-action-primary-bg text-action-primary-fg shadow-e2">
            <Icon name="check" weight="bold" size={22} />
          </div>
          <div>
            <h1 className="text-heading-md font-extrabold text-fg-primary">Halal Goes for restaurants</h1>
            <p className="text-body-sm text-fg-secondary">Sign in to manage orders, menu and hours.</p>
          </div>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {!needsTotp && (
              <>
                <Input
                  label="Business email"
                  id="email"
                  variant="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={setEmail}
                  placeholder="owner@restaurant.ca"
                  prefix={<IconMail size={16} />}
                />
                <Input
                  label="Password"
                  id="password"
                  variant="password"
                  required
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  prefix={<IconLock size={16} />}
                />
              </>
            )}

            {needsTotp && (
              <div className="hg-fade-up">
                <Input
                  label="6-digit authentication code"
                  id="totp"
                  variant="otp"
                  maxLength={6}
                  required
                  autoFocus
                  value={totp}
                  onChange={(v) => setTotp(v.replace(/\D/g, ''))}
                  helperText="Open your authenticator app and enter the current code for this account."
                />
              </div>
            )}

            {error ? (
              <p role="alert" className="text-body-sm font-semibold text-feedback-danger-text">
                {error}
              </p>
            ) : null}

            <Button type="submit" loading={busy} fullWidth className="mt-1">
              {needsTotp ? 'Verify and sign in' : 'Sign in'}
            </Button>
            {needsTotp && (
              <button
                type="button"
                onClick={() => setNeedsTotp(false)}
                className="text-label-sm font-bold text-fg-secondary underline underline-offset-2"
              >
                Use a different account
              </button>
            )}
          </form>
        </Card>

        <p className="mt-5 text-center text-body-sm text-fg-secondary">
          New to Halal Goes?{' '}
          <Link to="/register" className="font-bold text-action-primary-bg">
            Register your restaurant
          </Link>
        </p>
      </div>
    </div>
  );
}
