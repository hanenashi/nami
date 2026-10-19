import type { NamiMedia } from './api.js';

const chunkBytes = 256 * 1024;
const headers = { 'Tus-Resumable': '1.0.0' };
const uploadPath = (eventId: string) => `/api/events/${encodeURIComponent(eventId)}/uploads`;
const savedKey = (eventId: string, file: File) =>
  `nami-upload-v1:${eventId}:${file.name}:${file.size}:${file.lastModified}`;

async function failure(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return new Error(body.error || `Upload failed (${response.status}).`);
  } catch {
    return new Error(`Upload failed (${response.status}).`);
  }
}

function validLocation(eventId: string, location: string) {
  return new RegExp(`^${uploadPath(eventId)}/[0-9a-f-]{36}$`).test(location);
}

export async function cancelResumable(eventId: string, file: File) {
  const key = savedKey(eventId, file);
  const location = localStorage.getItem(key);
  if (!location || !validLocation(eventId, location)) {
    localStorage.removeItem(key);
    return;
  }
  const response = await fetch(location, { method: 'DELETE', headers });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw await failure(response);
  localStorage.removeItem(key);
}

export async function uploadResumable(
  eventId: string, file: File, signal: AbortSignal, onProgress: (bytes: number) => void,
): Promise<NamiMedia> {
  const key = savedKey(eventId, file);
  let location = localStorage.getItem(key);
  if (location && !validLocation(eventId, location)) {
    localStorage.removeItem(key);
    location = null;
  }
  let offset = 0;
  if (location) {
    const status = await fetch(location, { method: 'HEAD', headers, signal, cache: 'no-store' });
    if (status.status === 404 || status.status === 410) {
      localStorage.removeItem(key);
      location = null;
    } else if (!status.ok) throw await failure(status);
    else {
      if (Number(status.headers.get('upload-length')) !== file.size) throw new Error('Saved upload size changed. Cancel it and select the file again.');
      offset = Number(status.headers.get('upload-offset'));
      if (!Number.isInteger(offset) || offset < 0 || offset > file.size) throw new Error('The saved upload has an invalid offset.');
    }
  }
  if (!location) {
    const created = await fetch(uploadPath(eventId), {
      method: 'POST', headers: { ...headers, 'Upload-Length': String(file.size) }, signal,
    });
    if (!created.ok) throw await failure(created);
    location = created.headers.get('location');
    if (!location || !validLocation(eventId, location)) throw new Error('NAMI returned an invalid upload location.');
    localStorage.setItem(key, location);
  }
  onProgress(offset);
  while (offset < file.size) {
    const response = await fetch(location, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
      body: file.slice(offset, offset + chunkBytes), signal,
    });
    if (response.status === 409) {
      const current = await fetch(location, { method: 'HEAD', headers, signal, cache: 'no-store' });
      if (!current.ok) throw await failure(current);
      offset = Number(current.headers.get('upload-offset'));
      continue;
    }
    if (!response.ok) throw await failure(response);
    const next = Number(response.headers.get('upload-offset'));
    if (!Number.isInteger(next) || next <= offset || next > file.size) throw new Error('NAMI returned an invalid upload offset.');
    offset = next;
    onProgress(offset);
  }
  const finalized = await fetch(`${location}/finalize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalName: file.name }), signal,
  });
  if (!finalized.ok) throw await failure(finalized);
  const body = await finalized.json() as { media: NamiMedia };
  localStorage.removeItem(key);
  return body.media;
}
