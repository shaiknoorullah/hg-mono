import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Icon, Input } from '@hg/ui-web';
import { useAuth } from '../lib/auth';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await register({ businessName, email, password });
    setBusy(false);
    if (result.ok) {
      setDone(true);
      return;
    }
    setError(result.error ?? 'Registration failed.');
  }

  if (done) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
        <Card className="hg-fade-up max-w-[400px] text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-action-primary-bg text-action-primary-fg">
            <Icon name="check" weight="bold" size={22} />
          </div>
          <h1 className="text-heading-sm font-extrabold text-fg-primary">Check your inbox</h1>
          <p className="mt-2 text-body-sm text-fg-secondary">
            We sent a verification link to <strong className="text-fg-primary">{email}</strong>. Confirm it to start
            onboarding {businessName}.
          </p>
          <Button variant="secondary" fullWidth className="mt-6" onPress={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="hg-fade-up w-full max-w-[420px]">
        <div className="mb-7 text-center">
          <h1 className="text-heading-md font-extrabold text-fg-primary">Register your restaurant</h1>
          <p className="text-body-sm text-fg-secondary">
            Halal certification, documents and menu come next — this just opens the account.
          </p>
        </div>
        <Card>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Input
              label="Business name"
              required
              minLength={2}
              value={businessName}
              onChange={setBusinessName}
              placeholder="Damascus Sweets & Grill"
            />
            <Input
              label="Business email"
              variant="email"
              required
              autoComplete="username"
              value={email}
              onChange={setEmail}
              placeholder="owner@restaurant.ca"
            />
            <Input
              label="Password"
              variant="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              placeholder="At least 12 characters"
              helperText="At least 12 characters."
            />
            {error ? (
              <p role="alert" className="text-body-sm font-semibold text-feedback-danger-text">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy} fullWidth className="mt-1">
              Create account
            </Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-body-sm text-fg-secondary">
          Already registered?{' '}
          <Link to="/login" className="font-bold text-action-primary-bg">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
