import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Card, FieldError, Input, Label } from '../components/primitives';
import { IconCheck } from '../lib/icons';

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
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
        <Card className="hg-fade-up max-w-[400px] p-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--halal-tint)] text-[var(--halal-seal)]">
            <IconCheck size={22} />
          </div>
          <h1 className="text-[17px] font-extrabold text-[var(--ink)]">Check your inbox</h1>
          <p className="mt-2 text-[13.5px] text-[var(--ink2)]">
            We sent a verification link to <strong className="text-[var(--ink)]">{email}</strong>. Confirm it to
            start onboarding {businessName}.
          </p>
          <Button variant="secondary" className="mt-6 w-full" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4">
      <div className="hg-fade-up w-full max-w-[420px]">
        <div className="mb-7 text-center">
          <h1 className="text-[19px] font-extrabold text-[var(--ink)]">Register your restaurant</h1>
          <p className="text-[13.5px] text-[var(--ink2)]">
            Halal certification, documents and menu come next — this just opens the account.
          </p>
        </div>
        <Card className="p-6">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="business">Business name</Label>
              <Input
                id="business"
                required
                minLength={2}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Damascus Sweets & Grill"
              />
            </div>
            <div>
              <Label htmlFor="email">Business email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@restaurant.ca"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </div>
            <FieldError>{error}</FieldError>
            <Button type="submit" loading={busy} className="mt-1 w-full">
              Create account
            </Button>
          </form>
        </Card>
        <p className="mt-5 text-center text-[13px] text-[var(--ink2)]">
          Already registered?{' '}
          <Link to="/login" className="font-bold text-[var(--primary)]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
