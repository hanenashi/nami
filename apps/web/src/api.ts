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

export type EventAccess = {
  role: 'organizer' | 'contributor' | 'viewer';
  displayName: string;
};

export type Invitation = {
  id: string;
  role: 'contributor' | 'viewer';
  status: 'active' | 'redeemed' | 'expired' | 'revoked';
  guestName: string | null;
  expiresAt: number | null;
  createdAt: number;
  lastRedeemedAt: number | null;
  redemptionCount: number;
  canReplace: boolean;
};

export type InvitationPreview = {
  event: Pick<NamiEvent, 'id' | 'title' | 'description' | 'startDate' | 'endDate'>;
  role: 'contributor' | 'viewer';
  redeemedAs: string | null;
};

export type NamiMedia = {
  id: string;
  originalName: string;
  sizeBytes: number;
  width: number;
  height: number;
  previewWidth: number;
  previewHeight: number;
  createdAt: number;
  uploaderName: string;
  previewPath: string;
  downloadPath: string;
};

export type SuperadminPerson = {
  id: string;
  kind: 'organizer' | 'guest' | 'member';
  displayName: string;
  createdAt: number;
  sessions: number;
  photos: number;
  canPermanentlyDelete: boolean;
  events: { id: string; title: string; role: 'organizer' | 'contributor' | 'viewer' }[];
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

export async function getSuperadminStatus() {
  return readJson<{ configured: boolean; authenticated: boolean }>(await fetch('/api/superadmin/status', { cache: 'no-store' }));
}

export async function loginSuperadmin(password: string) {
  return readJson<{ authenticated: true }>(await fetch('/api/superadmin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }));
}

export async function logoutSuperadmin() {
  const response = await fetch('/api/superadmin/logout', { method: 'POST' });
  if (!response.ok) await readJson(response);
}

export async function getSuperadminPeople() {
  return readJson<{ people: SuperadminPerson[] }>(await fetch('/api/superadmin/people', { cache: 'no-store' }));
}

export async function signOutPerson(actorId: string) {
  const response = await fetch(`/api/superadmin/people/${encodeURIComponent(actorId)}/signout`, { method: 'POST' });
  if (!response.ok) await readJson(response);
}

export async function disableGuest(actorId: string) {
  const response = await fetch(`/api/superadmin/people/${encodeURIComponent(actorId)}/disable`, { method: 'POST' });
  if (!response.ok) await readJson(response);
}

export async function permanentlyDeleteGuest(actorId: string, confirmName: string) {
  const response = await fetch(`/api/superadmin/people/${encodeURIComponent(actorId)}/delete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmName }),
  });
  if (!response.ok) await readJson(response);
}

export async function resetOrganizerFromSuperadmin(password: string) {
  return readJson<{ reset: true; backupCreated: true }>(await fetch('/api/superadmin/organizer/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  }));
}

export async function getEvents() {
  return readJson<{ events: NamiEvent[] }>(await fetch('/api/events', { cache: 'no-store' }));
}

export async function getEvent(eventId: string) {
  return readJson<{ event: NamiEvent; access: EventAccess }>(await fetch(`/api/events/${encodeURIComponent(eventId)}`, { cache: 'no-store' }));
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

export async function deleteEvent(eventId: string, confirmTitle: string) {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmTitle }),
  });
  if (!response.ok) await readJson(response);
}

export async function getInvitations(eventId: string) {
  return readJson<{ invitations: Invitation[] }>(await fetch(`/api/events/${encodeURIComponent(eventId)}/invitations`, { cache: 'no-store' }));
}

export async function createInvitation(eventId: string, input: {
  role: 'contributor' | 'viewer';
  expiresInDays?: number;
}) {
  return readJson<{ invitation: Invitation; invitePath: string }>(await fetch(`/api/events/${encodeURIComponent(eventId)}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function revokeInvitation(eventId: string, invitationId: string) {
  const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Couldn’t revoke the invitation. Please try again.');
}

export async function replaceInvitation(eventId: string, invitationId: string) {
  return readJson<{ invitation: Invitation; invitePath: string }>(await fetch(
    `/api/events/${encodeURIComponent(eventId)}/invitations/${encodeURIComponent(invitationId)}/replace`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    },
  ));
}

export async function getInvitationPreview(secret: string) {
  return readJson<{ invitation: InvitationPreview }>(await fetch(`/api/invitations/${encodeURIComponent(secret)}`, { cache: 'no-store' }));
}

export async function redeemInvitation(secret: string, nickname?: string) {
  return readJson<{ event: { id: string }; access: EventAccess }>(await fetch(`/api/invitations/${encodeURIComponent(secret)}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  }));
}

export async function getMedia(eventId: string) {
  return readJson<{ media: NamiMedia[] }>(await fetch(`/api/events/${encodeURIComponent(eventId)}/media`, { cache: 'no-store' }));
}

export async function deleteMedia(eventId: string, ids: string[]) {
  return readJson<{ removed: number }>(await fetch(`/api/events/${encodeURIComponent(eventId)}/media`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  }));
}

export async function uploadPhoto(eventId: string, photo: File) {
  const body = new FormData();
  body.append('photo', photo);
  return readJson<{ media: NamiMedia }>(await fetch(`/api/events/${encodeURIComponent(eventId)}/media`, {
    method: 'POST',
    body,
  }));
}
