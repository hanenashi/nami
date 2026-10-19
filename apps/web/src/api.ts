export type AuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  organizer: { displayName: string } | null;
};

type AuthResult = {
  authenticated: true;
  organizer: { displayName: string };
};

export type NamiEvent = {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string | null;
  timezone: string | null;
  createdAt: number;
  updatedAt: number;
};

async function readJson<T extends object>(response: Response): Promise<T> {
  const body = await response.json() as T | { error?: string };
  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : 'Something went wrong. Please try again.');
  }
  return body as T;
}

export async function getAuthStatus() {
  return readJson<AuthStatus>(await fetch('/api/auth/status', { cache: 'no-store' }));
}

export async function setupOrganizer(displayName: string, password: string) {
  return readJson<AuthResult>(await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, password }),
  }));
}

export async function loginOrganizer(password: string) {
  return readJson<AuthResult>(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }));
}

export async function logoutOrganizer() {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Couldn’t sign out. Please try again.');
}

export async function getEvents() {
  return readJson<{ events: NamiEvent[] }>(await fetch('/api/events', { cache: 'no-store' }));
}

export async function getEvent(eventId: string) {
  return readJson<{ event: NamiEvent }>(await fetch(`/api/events/${encodeURIComponent(eventId)}`, { cache: 'no-store' }));
}

export async function createEvent(input: {
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  timezone?: string;
}) {
  return readJson<{ event: NamiEvent }>(await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}
