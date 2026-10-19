import { useEffect, useState, type FormEvent } from 'react';
import {
  createEvent,
  getAuthStatus,
  getEvent,
  getEvents,
  loginOrganizer,
  logoutOrganizer,
  setupOrganizer,
  type AuthStatus,
  type NamiEvent,
} from './api.js';

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

function formatCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(year, month - 1, day));
}

function formatEventDates(event: NamiEvent) {
  const start = formatCalendarDate(event.startDate);
  if (!event.endDate || event.endDate === event.startDate) return start;
  return `${start} – ${formatCalendarDate(event.endDate)}`;
}

function EventForm({ onCreated }: { onCreated: (event: NamiEvent) => void }) {
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitState('working');
    const form = new FormData(event.currentTarget);
    const endDate = String(form.get('endDate') ?? '');
    try {
      const result = await createEvent({
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? ''),
        startDate: String(form.get('startDate') ?? ''),
        endDate: endDate || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onCreated(result.event);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t create the event. Please try again.');
      setSubmitState('idle');
    }
  }

  return (
    <section className="create-event" aria-labelledby="create-event-heading">
      <h2 id="create-event-heading">Create an event</h2>
      <form className="event-form" onSubmit={submit}>
        <label className="field">
          <span>Event name</span>
          <input name="title" type="text" autoComplete="off" maxLength={120} required autoFocus />
        </label>
        <div className="date-fields">
          <label className="field">
            <span>Date</span>
            <input name="startDate" type="date" required />
          </label>
          <label className="field">
            <span>End date <small>(optional)</small></span>
            <input name="endDate" type="date" />
          </label>
        </div>
        <label className="field">
          <span>Description <small>(optional)</small></span>
          <textarea name="description" rows={4} maxLength={2000} />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={submitState === 'working'}>
          {submitState === 'working' ? 'Creating…' : 'Create event'}
        </button>
      </form>
    </section>
  );
}

function OrganizerHome({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<NamiEvent[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let ignore = false;
    getEvents().then(result => {
      if (!ignore) setEvents(result.events);
    }).catch(reason => {
      if (!ignore) setError(reason instanceof Error ? reason.message : 'Couldn’t load your events.');
    });
    return () => { ignore = true; };
  }, []);

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
    <section className="organizer-panel" aria-labelledby="organizer-heading">
      <p className="section-label">Organizer</p>
      <h1 id="organizer-heading">Hello, {displayName}.</h1>
      <p className="auth-introduction">Keep each gathering and its shared memories together.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {events ? (
        <>
          {events.length > 0 ? (
            <section className="events" aria-labelledby="events-heading">
              <div className="events-heading">
                <h2 id="events-heading">Your events</h2>
                {!showCreate ? <button className="secondary-button" type="button" onClick={() => setShowCreate(true)}>New event</button> : null}
              </div>
              <ul className="event-list">
                {events.map(event => (
                  <li key={event.id}>
                    <a className="event-card" href={`/organizer/events/${event.id}`}>
                      <strong>{event.title}</strong>
                      <span>{formatEventDates(event)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {showCreate || events.length === 0 ? (
            <EventForm onCreated={event => { location.href = `/organizer/events/${event.id}`; }} />
          ) : null}
        </>
      ) : <p className="loading-message">Loading your events…</p>}
      <button className="text-button" type="button" onClick={logout} disabled={working}>
        {working ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}

function EventDetail({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<NamiEvent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    getEvent(eventId).then(result => {
      if (!ignore) setEvent(result.event);
    }).catch(reason => {
      if (!ignore) setError(reason instanceof Error ? reason.message : 'Couldn’t load this event.');
    });
    return () => { ignore = true; };
  }, [eventId]);

  if (error) {
    return (
      <section className="event-detail">
        <a className="back-link" href="/organizer">← Your events</a>
        <p className="form-error" role="alert">{error}</p>
      </section>
    );
  }
  if (!event) return <p className="page-message">Opening event…</p>;

  return (
    <article className="event-detail">
      <a className="back-link" href="/organizer">← Your events</a>
      <p className="section-label">Event</p>
      <h1>{event.title}</h1>
      <p className="event-date">{formatEventDates(event)}</p>
      {event.description ? <p className="event-description">{event.description}</p> : null}
      <section className="event-coming-next" aria-labelledby="sharing-heading">
        <h2 id="sharing-heading">Share it together</h2>
        <p>Invitations and photos will appear here.</p>
      </section>
    </article>
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
    const eventMatch = /^\/organizer\/events\/([^/]+)$/.exec(location.pathname);
    if (eventMatch) return <EventDetail eventId={eventMatch[1]} />;
    return <OrganizerHome displayName={status.organizer.displayName} onLogout={() => setStatus({ setupRequired: false, authenticated: false, organizer: null })} />;
  }
  return <Login onComplete={setStatus} />;
}
