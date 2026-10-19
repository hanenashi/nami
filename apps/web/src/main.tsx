import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from './copy.js';
import { Organizer } from './Organizer.js';
import { GuestEvent, InvitationPage } from './Invitation.js';
import { Superadmin } from './Superadmin.js';
import './styles.css';

function Shell({ children, album = false }: { children: React.ReactNode; album?: boolean }) {
  return (
    <div className={album ? 'page page-album' : 'page'}>
      <header className="masthead">
        <a className="wordmark" href="/">{copy.brand}</a>
        <span className="subtitle" lang="cs">{copy.subtitle}</span>
      </header>
      <main>{children}</main>
      <footer>
        <span>{copy.brand} · {copy.motto}</span>
        <a href="/organizer">Organizer</a>
      </footer>
    </div>
  );
}

function Welcome() {
  return (
    <Shell>
        <section className="welcome" aria-labelledby="welcome-heading">
          <h1 id="welcome-heading">{copy.heading}</h1>
          <p className="introduction">{copy.introduction}</p>
        </section>
        <section className="about" aria-labelledby="gathering-heading">
          <h2 id="gathering-heading">{copy.gathering}</h2>
          <p>{copy.description}</p>
          <details>
            <summary>
              <span>{copy.how}</span>
              <svg className="disclosure-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12h16" />
                <path className="vertical" d="M12 4v16" />
              </svg>
            </summary>
            <div className="explanation">
              <ol>{copy.steps.map(step => <li key={step}>{step}</li>)}</ol>
              <p>{copy.availability}</p>
            </div>
          </details>
        </section>
    </Shell>
  );
}

function App() {
  if (location.pathname === '/superadmin') return <Shell><Superadmin /></Shell>;
  if (location.pathname === '/organizer' || location.pathname.startsWith('/organizer/events/')) {
    return <Shell album={location.pathname.startsWith('/organizer/events/')}><Organizer /></Shell>;
  }
  const invitationMatch = /^\/invite\/([^/]+)$/.exec(location.pathname);
  if (invitationMatch) return <Shell><InvitationPage secret={invitationMatch[1]} /></Shell>;
  const eventMatch = /^\/events\/([^/]+)$/.exec(location.pathname);
  if (eventMatch) return <Shell album><GuestEvent eventId={eventMatch[1]} /></Shell>;
  return <Welcome />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
