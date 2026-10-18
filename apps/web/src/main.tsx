import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from './copy.js';
import './styles.css';

function Welcome() {
  return (
    <div className="page">
      <header className="masthead">
        <span className="wordmark">{copy.brand}</span>
        <span className="subtitle" lang="cs">{copy.subtitle}</span>
      </header>
      <main>
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
      </main>
      <footer>{copy.brand} · {copy.motto}</footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Welcome /></StrictMode>);
