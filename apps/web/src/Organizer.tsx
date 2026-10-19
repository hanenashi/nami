import { useEffect, useState, type FormEvent } from 'react';
import { getAuthStatus, loginOrganizer, logoutOrganizer, setupOrganizer, type AuthStatus } from './api.js';

type SubmitState = 'idle' | 'working';

function Field({ label, name, autoComplete, minLength, helper }: {
  label: string;
  name: string;
  autoComplete: string;
  minLength?: number;
  helper?: string;
}) {
  const helperId = helper ? `${name}-helper` : undefined;
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type="password"
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={256}
        aria-describedby={helperId}
        required
      />
      {helper ? <small id={helperId}>{helper}</small> : null}
    </label>
  );
}

function Setup({ onComplete }: { onComplete: (status: AuthStatus) => void }) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get('displayName') ?? '');
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');
    if (password !== confirmation) {
      setError('Those passphrases don’t match.');
      return;
    }
    setSubmitState('working');
    try {
      const result = await setupOrganizer(displayName, password);
      onComplete({ setupRequired: false, ...result });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong. Please try again.');
      setSubmitState('idle');
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="setup-heading">
      <p className="section-label">First visit</p>
      <h1 id="setup-heading">Make NAMI yours.</h1>
      <p className="auth-introduction">Choose the name and passphrase you’ll use to organize family events.</p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Your name</span>
          <input name="displayName" type="text" autoComplete="name" maxLength={80} required autoFocus />
        </label>
        <Field label="Passphrase" name="password" autoComplete="new-password" minLength={12} helper="At least 12 characters. A few unrelated words work well." />
        <Field label="Passphrase again" name="confirmation" autoComplete="new-password" minLength={12} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={submitState === 'working'}>
          {submitState === 'working' ? 'Setting up…' : 'Set up NAMI'}
        </button>
      </form>
      <p className="form-note">This creates the only organizer account. NAMI doesn’t send password recovery email yet.</p>
    </section>
  );
}

function Login({ onComplete }: { onComplete: (status: AuthStatus) => void }) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitState('working');
    const form = new FormData(event.currentTarget);
    try {
      const result = await loginOrganizer(String(form.get('password') ?? ''));
      onComplete({ setupRequired: false, ...result });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong. Please try again.');
      setSubmitState('idle');
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="login-heading">
      <p className="section-label">Organizer</p>
      <h1 id="login-heading">Welcome back.</h1>
      <p className="auth-introduction">Sign in to look after your events.</p>
      <form onSubmit={submit}>
        <Field label="Passphrase" name="password" autoComplete="current-password" />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={submitState === 'working'}>
          {submitState === 'working' ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}

function OrganizerHome({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setWorking(true);
    setError('');
    try {
      await logoutOrganizer();
      onLogout();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t sign out. Please try again.');
      setWorking(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="organizer-heading">
      <p className="section-label">Organizer</p>
      <h1 id="organizer-heading">Hello, {displayName}.</h1>
      <p className="auth-introduction">Your family events will live here. Creating the first one comes next.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="text-button" type="button" onClick={logout} disabled={working}>
        {working ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}

export function Organizer() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let ignore = false;
    getAuthStatus().then(result => {
      if (!ignore) setStatus(result);
    }).catch(reason => {
      if (!ignore) setLoadError(reason instanceof Error ? reason.message : 'NAMI couldn’t load.');
    });
    return () => { ignore = true; };
  }, []);

  if (loadError) return <p className="page-message" role="alert">{loadError}</p>;
  if (!status) return <p className="page-message">Opening NAMI…</p>;
  if (status.setupRequired) return <Setup onComplete={setStatus} />;
  if (status.authenticated && status.organizer) {
    return <OrganizerHome displayName={status.organizer.displayName} onLogout={() => setStatus({ setupRequired: false, authenticated: false, organizer: null })} />;
  }
  return <Login onComplete={setStatus} />;
}
