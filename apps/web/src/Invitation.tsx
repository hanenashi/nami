import { useEffect, useState, type FormEvent } from 'react';
import {
  getEvent,
  getMedia,
  getInvitationPreview,
  logoutOrganizer,
  redeemInvitation,
  type EventAccess,
  type InvitationPreview,
  type NamiEvent,
  type NamiMedia,
} from './api.js';
import { formatEventDates } from './dates.js';
import { EventPhotos } from './Photos.js';

export function InvitationPage({ secret }: { secret: string }) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let ignore = false;
    getInvitationPreview(secret).then(result => {
      if (!ignore) setInvitation(result.invitation);
    }).catch(reason => {
      if (!ignore) setError(reason instanceof Error ? reason.message : 'This invitation could not be opened.');
    });
    return () => { ignore = true; };
  }, [secret]);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await redeemInvitation(secret, invitation?.redeemedAs ? undefined : String(form.get('nickname') ?? ''));
      location.replace(`/events/${result.event.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t join the event. Please try again.');
      setWorking(false);
    }
  }

  if (error && !invitation) return <p className="page-message" role="alert">{error}</p>;
  if (!invitation) return <p className="page-message">Opening invitation…</p>;
  const action = invitation.role === 'contributor' ? 'add photos to' : 'view photos from';

  return (
    <section className="invitation-page" aria-labelledby="invitation-heading">
      <p className="section-label">You’re invited</p>
      <h1 id="invitation-heading">{invitation.event.title}</h1>
      <p className="event-date">{formatEventDates(invitation.event)}</p>
      <p className="invitation-introduction">Join this event to {action} the gathering.</p>
      <form onSubmit={redeem}>
        {invitation.redeemedAs ? (
          <p className="returning-guest">Continue as <strong>{invitation.redeemedAs}</strong>.</p>
        ) : (
          <label className="field">
            <span>Your name</span>
            <input name="nickname" type="text" autoComplete="name" maxLength={80} required autoFocus />
          </label>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={working}>
          {working ? 'Joining…' : 'Join event'}
        </button>
      </form>
      <p className="form-note">Anyone with this link can use this invitation until the organizer revokes it.</p>
    </section>
  );
}

export function GuestEvent({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<NamiEvent | null>(null);
  const [access, setAccess] = useState<EventAccess | null>(null);
  const [media, setMedia] = useState<NamiMedia[] | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    Promise.all([getEvent(eventId), getMedia(eventId)]).then(([eventResult, mediaResult]) => {
      if (!ignore) {
        setEvent(eventResult.event);
        setAccess(eventResult.access);
        setMedia(mediaResult.media);
      }
    }).catch(reason => {
      if (!ignore) setError(reason instanceof Error ? reason.message : 'This event could not be opened.');
    });
    return () => { ignore = true; };
  }, [eventId]);

  async function leave() {
    setLeaving(true);
    try {
      await logoutOrganizer();
      location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t leave the event. Please try again.');
      setLeaving(false);
    }
  }

  if (error && !event) return <p className="page-message" role="alert">{error}</p>;
  if (!event || !access || !media) return <p className="page-message">Opening event…</p>;
  return (
    <article className="event-detail guest-event event-album">
      <header className="album-header">
        <p className="album-greeting">Hello, {access.displayName}</p>
        <h1>{event.title}</h1>
        <p className="event-date">{formatEventDates(event)}</p>
        {event.description ? <p className="event-description">{event.description}</p> : null}
      </header>
      <EventPhotos eventId={event.id} role={access.role} initialMedia={media} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="text-button leave-event" type="button" onClick={leave} disabled={leaving}>
        {leaving ? 'Leaving…' : 'Leave event'}
      </button>
    </article>
  );
}
