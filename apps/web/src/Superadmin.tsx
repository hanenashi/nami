import { useEffect, useState, type FormEvent } from 'react';
import {
  disableGuest, getSuperadminPeople, getSuperadminStatus, loginSuperadmin, permanentlyDeleteGuest,
  logoutSuperadmin, replaceOrganizer, resetNamiInstance, resetOrganizerFromSuperadmin, signOutPerson,
  type SuperadminPerson,
} from './api.js';

export function Superadmin() {
  const [status, setStatus] = useState<{ configured: boolean; authenticated: boolean } | null>(null);
  const [people, setPeople] = useState<SuperadminPerson[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let ignore = false;
    getSuperadminStatus().then(result => { if (!ignore) setStatus(result); })
      .catch(reason => { if (!ignore) setError(reason instanceof Error ? reason.message : 'Couldn’t open owner controls.'); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    let ignore = false;
    getSuperadminPeople().then(result => { if (!ignore) setPeople(result.people); })
      .catch(reason => { if (!ignore) setError(reason instanceof Error ? reason.message : 'Couldn’t load people.'); });
    return () => { ignore = true; };
  }, [status?.authenticated]);

  async function refresh() { setPeople((await getSuperadminPeople()).people); }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setWorking(true);
    setError('');
    try {
      await loginSuperadmin(String(new FormData(form).get('password') ?? ''));
      form.reset();
      setStatus({ configured: true, authenticated: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t sign in.');
    } finally { setWorking(false); }
  }

  async function logout() {
    setWorking(true);
    setError('');
    try {
      await logoutSuperadmin();
      setPeople(null);
      setStatus({ configured: true, authenticated: false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t sign out.');
    } finally { setWorking(false); }
  }

  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirmation') ?? '')) {
      setError('Those passphrases don’t match.');
      return;
    }
    if (!window.confirm('Reset the organizer passphrase? All current organizer sessions will be signed out. Events, photos and guest access stay in place.')) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await resetOrganizerFromSuperadmin(password);
      form.reset();
      setNotice('Organizer passphrase changed. A private SQLite backup was created, and old organizer sessions were signed out.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t reset the organizer passphrase.');
    } finally { setWorking(false); }
  }

  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const displayName = String(data.get('displayName') ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirmation') ?? '')) {
      setError('Those passphrases don’t match.');
      return;
    }
    if (!window.confirm(`Replace the organizer with ${displayName}? Existing events and photos stay, but old organizer sessions will end and existing photo attribution will show the new name.`)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await replaceOrganizer(displayName, password);
      form.reset();
      await refresh();
      setNotice(`Organizer changed to ${displayName}. A private SQLite backup was created, and old organizer sessions were signed out.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t replace the organizer.');
    } finally { setWorking(false); }
  }

  async function resetInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const phrase = String(data.get('confirmation') ?? '');
    if (phrase !== 'ERASE ALL NAMI DATA') {
      setError('The reset phrase did not match. Nothing was erased.');
      return;
    }
    if (!window.confirm('Final check: erase the organizer, all guests, events, invitations, photos, and uploads? A full private backup will be verified first. This cannot be undone from the web page.')) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await resetNamiInstance(String(data.get('password') ?? ''), phrase);
      form.reset();
      await refresh();
      setNotice(result.cleanupPending
        ? 'NAMI was reset and backed up, but some old media files need host cleanup.'
        : 'NAMI was reset. The verified full backup is in NAMI’s private backups folder. You can now create a new organizer.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t reset NAMI.');
    } finally { setWorking(false); }
  }

  async function personAction(person: SuperadminPerson, action: 'signout' | 'disable') {
    const message = action === 'disable'
      ? `Disable ${person.displayName}’s guest access? Their invitation links and sessions will stop working. Their photos stay in the album.`
      : `Sign out ${person.displayName} on every device?`;
    if (!window.confirm(message)) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      if (action === 'disable') await disableGuest(person.id);
      else await signOutPerson(person.id);
      await refresh();
      setNotice(action === 'disable' ? `${person.displayName}’s guest access was disabled.` : `${person.displayName} was signed out.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t update this person.');
    } finally { setWorking(false); }
  }

  async function deleteGuest(person: SuperadminPerson) {
    const confirmation = window.prompt(`Permanently delete ${person.displayName}? This removes their account and invitation history. It cannot be undone. Type their name to confirm:`, '');
    if (confirmation === null) return;
    if (confirmation !== person.displayName) {
      setError('The name did not match. Nothing was deleted.');
      return;
    }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      await permanentlyDeleteGuest(person.id, confirmation);
      await refresh();
      setNotice(`${person.displayName} was permanently deleted. A private SQLite backup was created first.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t delete this person.');
    } finally { setWorking(false); }
  }

  if (error && !status) return <p className="page-message" role="alert">{error}</p>;
  if (!status) return <p className="page-message">Opening owner controls…</p>;
  if (!status.configured) return (
    <section className="superadmin-page auth-panel">
      <p className="section-label">Owner controls</p>
      <h1>Private access first.</h1>
      <p className="auth-introduction">Set a separate superadmin passphrase once from an interactive Beechan terminal:</p>
      <code className="setup-command">docker compose exec nami node apps/api/dist/superadmin-setup.js</code>
      <p className="form-note">The prompt hides what you type. This page has no default password.</p>
    </section>
  );
  if (!status.authenticated) return (
    <section className="superadmin-page auth-panel">
      <p className="section-label">Owner controls</p>
      <h1>Superadmin.</h1>
      <p className="auth-introduction">Sign in to manage NAMI accounts and access.</p>
      <form onSubmit={login}>
        <label className="field"><span>Superadmin passphrase</span><input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={256} required /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={working}>{working ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  );

  const organizer = people?.find(person => person.kind === 'organizer');

  return (
    <section className="superadmin-page">
      <div className="superadmin-heading">
        <div><p className="section-label">Owner controls</p><h1>People in NAMI.</h1></div>
        <button className="text-button" type="button" onClick={logout} disabled={working}>Sign out</button>
      </div>
      <p className="superadmin-intro">Manage NAMI accounts and access. Guest deletion is available only for empty, inactive accounts.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="superadmin-notice" role="status">{notice}</p> : null}
      {!people ? <p>Loading people…</p> : (
        <div className="people-list">
          {people.map(person => (
            <article className="person-card" key={person.id}>
              <div className="person-top"><h2>{person.displayName}</h2><span>{person.kind === 'organizer' ? 'Organizer' : person.kind === 'guest' ? 'Guest' : 'Member'}</span></div>
              <p>{person.photos} {person.photos === 1 ? 'photo' : 'photos'} · {person.sessions} {person.sessions === 1 ? 'active session' : 'active sessions'}</p>
              {person.events.length ? <ul>{person.events.map(event => <li key={event.id}>{event.title} · {event.role}</li>)}</ul> : <p>No current event access</p>}
              <div className="person-actions">
                {person.sessions > 0 ? <button className="secondary-button" type="button" onClick={() => void personAction(person, 'signout')} disabled={working}>Sign out all devices</button> : null}
                {person.kind === 'guest' && person.events.length > 0 ? <button className="quiet-danger" type="button" onClick={() => void personAction(person, 'disable')} disabled={working}>Disable guest access</button> : null}
                {person.canPermanentlyDelete ? <button className="quiet-danger" type="button" onClick={() => void deleteGuest(person)} disabled={working}>Permanently delete</button> : null}
              </div>
            </article>
          ))}
        </div>
      )}
      {people && !organizer ? <p className="superadmin-notice">NAMI has no organizer. <a href="/organizer">Create one now</a>.</p> : null}
      {organizer ? <details className="superadmin-reset">
        <summary>Replace organizer, keep the album</summary>
        <form onSubmit={replace}>
          <p>Change the organizer’s name and passphrase while keeping events, guests, and photos. Existing photos will show the new organizer name. Old organizer sessions will end. A SQLite backup is made first.</p>
          <label className="field"><span>New organizer name</span><input name="displayName" type="text" autoComplete="name" maxLength={80} required /></label>
          <label className="field"><span>Replacement passphrase</span><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
          <label className="field"><span>Repeat replacement passphrase</span><input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
          <button className="primary-button" type="submit" disabled={working}>Replace organizer</button>
        </form>
      </details> : null}
      {organizer ? <details className="superadmin-reset">
        <summary>Reset organizer passphrase</summary>
        <form onSubmit={reset}>
          <p>Use this when the organizer can no longer sign in. NAMI makes a private SQLite backup before changing the passphrase.</p>
          <label className="field"><span>New organizer passphrase</span><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
          <label className="field"><span>Repeat new passphrase</span><input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
          <button className="primary-button" type="submit" disabled={working}>Reset passphrase</button>
        </form>
      </details> : null}
      {organizer ? <details className="superadmin-reset superadmin-danger">
        <summary>Erase NAMI and start over</summary>
        <form onSubmit={resetInstance}>
          <p>This removes every organizer and guest account, event, invitation, photo, and upload. A verified backup of the database and photo files is saved locally first. Your separate superadmin login stays.</p>
          <label className="field"><span>Superadmin passphrase</span><input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={256} required /></label>
          <label className="field"><span>Type ERASE ALL NAMI DATA</span><input name="confirmation" type="text" autoComplete="off" required /></label>
          <button className="secondary-button" type="submit" disabled={working}>Erase NAMI data</button>
        </form>
      </details> : null}
    </section>
  );
}
