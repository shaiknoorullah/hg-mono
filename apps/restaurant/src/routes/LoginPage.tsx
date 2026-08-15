import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Card, FieldError, Input, Label } from '../components/primitives';
import { IconLock, IconMail, IconShieldCheck } from '../lib/icons';

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
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="hg-fade-up w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-[var(--r)] bg-[var(--halal-seal)] text-white shadow-[var(--shadow-2)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C7.58172 2 4 6.00258 4 10.5C4 14.9622 6.55332 19.8124 10.5371 21.6744C11.4657 22.1085 12.5343 22.1085 13.4629 21.6744C17.4467 19.8124 20 14.9622 20 10.5C20 6.00258 16.4183 2 12 2Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-[19px] font-extrabold text-[var(--ink)]">Halal Goes for restaurants</h1>
            <p className="text-[13.5px] text-[var(--ink2)]">Sign in to manage orders, menu and hours.</p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {!needsTotp && (
              <>
                <div>
                  <Label htmlFor="email">Business email</Label>
                  <div className="relative">
                    <IconMail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink3)]" />
                    <Input
                      id="email"
                      type="email"
                      required
                      autoComplete="username"
                      className="pl-9"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="owner@restaurant.ca"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <IconLock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink3)]" />
                    <Input
                      id="password"
                      type="password"
                      required
                      autoComplete="current-password"
                      className="pl-9"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </>
            )}

            {needsTotp && (
              <div className="hg-fade-up">
                <Label htmlFor="totp">6-digit authentication code</Label>
                <div className="relative">
                  <IconShieldCheck size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--halal-seal)]" />
                  <Input
                    id="totp"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    className="pl-9 tracking-[0.3em]"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                  />
                </div>
                <p className="mt-1.5 text-[12.5px] text-[var(--ink2)]">
                  Open your authenticator app and enter the current code for this account.
                </p>
              </div>
            )}

            <FieldError>{error}</FieldError>

            <Button type="submit" loading={busy} className="mt-1 w-full">
              {needsTotp ? 'Verify and sign in' : 'Sign in'}
            </Button>
            {needsTotp && (
              <button
                type="button"
                onClick={() => setNeedsTotp(false)}
                className="text-[12.5px] font-bold text-[var(--ink2)] underline underline-offset-2"
              >
                Use a different account
              </button>
            )}
          </form>
        </Card>

        <p className="mt-5 text-center text-[13px] text-[var(--ink2)]">
          New to Halal Goes?{' '}
          <Link to="/register" className="font-bold text-[var(--primary)]">
            Register your restaurant
          </Link>
        </p>
      </div>
    </div>
  );
}
