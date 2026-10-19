import { useEffect, useState, type FormEvent } from 'react';
import {
  createEvent,
  createInvitation,
  deleteEvent,
  getAuthStatus,
  getEvent,
  getEvents,
  getInvitations,
  getMedia,
  loginOrganizer,
  logoutOrganizer,
  replaceInvitation,
  revokeInvitation,
  setupOrganizer,
  type AuthStatus,
  type Invitation,
  type NamiEvent,
  type NamiMedia,
} from './api.js';
import { formatEventDates, formatTimestampDate } from './dates.js';
import { EventPhotos } from './Photos.js';

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

function invitationDescription(invitation: Invitation) {
  const role = invitation.role === 'contributor' ? 'Contributor' : 'Viewer';
  const guest = invitation.guestName ? ` · ${invitation.guestName}` : '';
  if (invitation.status === 'revoked') return `${role}${guest} · Revoked`;
  if (invitation.status === 'expired') return `${role}${guest} · Link expired`;
  if (invitation.status === 'active' && invitation.guestName) return `${role}${guest} · Waiting for new link`;
  if (invitation.guestName) return `${role} · ${invitation.guestName}`;
  return `${role} · Waiting to be opened`;
}

function InvitationsPanel({ eventId, initialInvitations }: { eventId: string; initialInvitations: Invitation[] }) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [newLink, setNewLink] = useState('');
  const [working, setWorking] = useState(false);
  const [revoking, setRevoking] = useState('');
  const [replacing, setReplacing] = useState('');
  const [linkLabel, setLinkLabel] = useState('Invitation ready');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError('');
    setCopied(false);
    const form = new FormData(event.currentTarget);
    const expiry = String(form.get('expiry') ?? '');
    try {
      const result = await createInvitation(eventId, {
        role: String(form.get('role')) as 'contributor' | 'viewer',
        expiresInDays: expiry ? Number(expiry) : undefined,
      });
      setInvitations(current => [result.invitation, ...current]);
      setLinkLabel('Invitation ready');
      setNewLink(`${location.origin}${result.invitePath}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t create the invitation.');
    } finally {
      setWorking(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
    } catch {
      setError('Select the invitation link and copy it manually.');
    }
  }

  async function revoke(invitationId: string) {
    setRevoking(invitationId);
    setError('');
    try {
      await revokeInvitation(eventId, invitationId);
      setInvitations(current => current.map(invitation => (
        invitation.id === invitationId ? { ...invitation, status: 'revoked' } : invitation
      )));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t revoke the invitation.');
    } finally {
      setRevoking('');
    }
  }

  async function replace(invitation: Invitation) {
    if (!invitation.guestName) return;
    if (!window.confirm(`Replace ${invitation.guestName}’s invitation? Their old link and current sessions will stop working. Give the new link only to ${invitation.guestName} after checking with them.`)) return;
    setReplacing(invitation.id);
    setError('');
    setCopied(false);
    setNewLink('');
    try {
      const result = await replaceInvitation(eventId, invitation.id);
      setLinkLabel(`Replacement link for ${invitation.guestName}`);
      setNewLink(`${location.origin}${result.invitePath}`);
      setInvitations((await getInvitations(eventId)).invitations);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t replace the invitation.');
    } finally {
      setReplacing('');
    }
  }

  return (
    <section className="invitation-panel" aria-labelledby="invitations-heading">
      <h2 id="invitations-heading">Invite someone</h2>
      <p>Create a private link for one person. You can revoke it whenever you need to.</p>
      <form className="invitation-form" onSubmit={create}>
        <fieldset className="choice-group">
          <legend>They can</legend>
          <div className="choice-options">
            <label className="choice"><input type="radio" name="role" value="contributor" defaultChecked /> <span>Add and view photos</span></label>
            <label className="choice"><input type="radio" name="role" value="viewer" /> <span>View photos only</span></label>
          </div>
        </fieldset>
        <fieldset className="choice-group">
          <legend>Link expires</legend>
          <div className="choice-options">
            <label className="choice"><input type="radio" name="expiry" value="7" /> <span>In 7 days</span></label>
            <label className="choice"><input type="radio" name="expiry" value="30" defaultChecked /> <span>In 30 days</span></label>
            <label className="choice"><input type="radio" name="expiry" value="" /> <span>Never</span></label>
          </div>
        </fieldset>
        <button className="primary-button" type="submit" disabled={working}>
          {working ? 'Creating…' : 'Create invitation'}
        </button>
      </form>
      {newLink ? (
        <div className="new-invitation" role="status">
          <strong>{linkLabel}</strong>
          <label className="field">
            <span>Copy this link now</span>
            <input aria-label="Invitation link" type="text" value={newLink} readOnly onFocus={event => event.currentTarget.select()} />
          </label>
          <button className="secondary-button" type="button" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
          <small>During local testing, the link opens only on a device connected to this NAMI address.</small>
          {linkLabel.startsWith('Replacement') ? <small>This link opens the existing guest identity. Check who receives it before sharing.</small> : null}
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {invitations.length > 0 ? (
        <div className="invitation-history">
          <h3>Invitations</h3>
          <ul>
            {invitations.map(invitation => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitationDescription(invitation)}</strong>
                  <span>
                    {invitation.expiresAt ? `Expires ${formatTimestampDate(invitation.expiresAt)}` : 'No expiry'}
                    {invitation.redemptionCount > 1 ? ` · Opened ${invitation.redemptionCount} times` : ''}
                  </span>
                </div>
                <div className="invitation-actions">
                  {invitation.canReplace && invitation.guestName ? (
                    <button className="small-button" type="button" onClick={() => replace(invitation)} disabled={Boolean(replacing || revoking)}>
                      {replacing === invitation.id ? 'Replacing…' : `Replace ${invitation.guestName}’s link`}
                    </button>
                  ) : null}
                  {invitation.status === 'active' || invitation.status === 'redeemed' ? (
                    <button className="small-button" type="button" onClick={() => revoke(invitation.id)} disabled={Boolean(revoking || replacing)}>
                      {revoking === invitation.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [media, setMedia] = useState<NamiMedia[] | null>(null);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let ignore = false;
    Promise.all([getEvent(eventId), getInvitations(eventId), getMedia(eventId)]).then(([eventResult, invitationResult, mediaResult]) => {
      if (!ignore) {
        setEvent(eventResult.event);
        setInvitations(invitationResult.invitations);
        setMedia(mediaResult.media);
      }
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
  if (!event || !invitations || !media) return <p className="page-message">Opening event…</p>;

  async function removeEvent() {
    if (!event || confirmTitle !== event.title || !acknowledged) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteEvent(event.id, confirmTitle);
      location.href = '/organizer';
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Couldn’t delete this event.');
      setDeleting(false);
    }
  }

  return (
    <article className="event-detail event-album">
      <header className="album-header">
        <div className="album-header-top">
          <a className="album-back" href="/organizer">← Your events</a>
          <a className="album-invite-link" href="#album-invitations" onClick={() => {
            const panel = document.getElementById('album-invitations') as HTMLDetailsElement | null;
            if (panel) panel.open = true;
          }}>Invite people</a>
        </div>
        <h1>{event.title}</h1>
        <p className="event-date">{formatEventDates(event)}</p>
        {event.description ? <p className="event-description">{event.description}</p> : null}
      </header>
      <EventPhotos eventId={event.id} role="organizer" initialMedia={media} />
      <details className="album-invitations" id="album-invitations">
        <summary>People &amp; invitations</summary>
        <InvitationsPanel eventId={event.id} initialInvitations={invitations} />
      </details>
      <details className="event-settings">
        <summary>Event settings</summary>
        {!showDelete ? <button type="button" className="quiet-danger" onClick={() => setShowDelete(true)}>Delete event…</button> :
          <div className="delete-event-panel">
            <p>Deleting this event also removes its photos and invitations. This cannot be undone.</p>
            {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
            <label className="field"><span>Type the event name to confirm</span><input type="text" value={confirmTitle} onChange={event => setConfirmTitle(event.target.value)} autoComplete="off" /></label>
            <label className="delete-acknowledge"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} /> I understand the photos and invitations will be removed.</label>
            <div className="delete-event-actions">
              <button type="button" className="remove-photos" disabled={deleting || confirmTitle !== event.title || !acknowledged} onClick={() => void removeEvent()}>{deleting ? 'Deleting…' : 'Delete event permanently'}</button>
              <button type="button" disabled={deleting} onClick={() => { setShowDelete(false); setConfirmTitle(''); setAcknowledged(false); }}>Cancel</button>
            </div>
          </div>}
      </details>
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
