import { useRef, useState, type FormEvent } from 'react';
import { uploadPhoto, type EventAccess, type NamiMedia } from './api.js';
import { cancelResumable, uploadResumable } from './resumable.js';

const maxPhotoBytes = 25 * 1024 * 1024;

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 0.1) return '<0.1';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(megabytes);
}

type BatchItem = { id: string; file: File; status: 'waiting' | 'uploading' | 'processing' | 'paused' | 'failed' | 'ready' | 'cancelled'; bytes: number; error?: string };

export function EventPhotos({ eventId, role, initialMedia }: {
  eventId: string;
  role: EventAccess['role'];
  initialMedia: NamiMedia[];
}) {
  const [media, setMedia] = useState(initialMedia);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const batchRef = useRef<BatchItem[]>([]);
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  const paused = useRef(false);
  const cancelled = useRef(new Set<string>());
  const updateItem = (id: string, patch: Partial<BatchItem>) => {
    batchRef.current = batchRef.current.map(item => item.id === id ? { ...item, ...patch } : item);
    setBatch([...batchRef.current]);
  };
  async function runQueue() {
    if (running.current || paused.current) return;
    running.current = true;
    try {
      while (!paused.current) {
        const item = batchRef.current.find(entry => entry.status === 'waiting');
        if (!item) break;
        const controller = new AbortController();
        active.current = controller;
        updateItem(item.id, { status: 'uploading', error: undefined });
        try {
          const result = await uploadResumable(eventId, item.file, controller.signal, bytes =>
            updateItem(item.id, { bytes, status: bytes === item.file.size ? 'processing' : 'uploading' }));
          setMedia(current => current.some(photo => photo.id === result.id) ? current : [result, ...current]);
          updateItem(item.id, { status: 'ready', bytes: item.file.size });
        } catch (reason) {
          if (cancelled.current.has(item.id)) {
            try {
              await cancelResumable(eventId, item.file);
              updateItem(item.id, { status: 'cancelled' });
            } catch (cancelError) {
              updateItem(item.id, { status: 'failed', error: cancelError instanceof Error ? cancelError.message : 'Could not cancel upload.' });
            }
          } else if (controller.signal.aborted) {
            updateItem(item.id, { status: 'paused' });
          } else {
            updateItem(item.id, { status: 'failed', error: reason instanceof Error ? reason.message : 'Upload failed.' });
          }
        } finally { active.current = null; }
      }
    } finally {
      running.current = false;
      if (!paused.current && batchRef.current.some(item => item.status === 'waiting')) void runQueue();
    }
  }
  function chooseBatch(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const accepted = files.filter(file => /\.jpe?g$/i.test(file.name) && file.size > 0 && file.size <= maxPhotoBytes);
    if (accepted.length !== files.length) setError('Choose JPEG files up to 25 MB each.');
    else setError('');
    batchRef.current = [...batchRef.current, ...accepted.map(file => ({
      id: crypto.randomUUID(), file, status: 'waiting' as const, bytes: 0,
    }))];
    setBatch([...batchRef.current]);
    void runQueue();
  }
  function pauseBatch() {
    paused.current = true;
    active.current?.abort();
    setBatch([...batchRef.current]);
  }
  function resumeBatch() {
    paused.current = false;
    batchRef.current = batchRef.current.map(item => item.status === 'paused' ? { ...item, status: 'waiting' } : item);
    setBatch([...batchRef.current]);
    void runQueue();
  }
  function retry(id: string) { cancelled.current.delete(id); updateItem(id, { status: 'waiting' }); void runQueue(); }
  function cancel(item: BatchItem) {
    cancelled.current.add(item.id);
    if (item.status === 'uploading') active.current?.abort();
    else {
      updateItem(item.id, { status: 'cancelled' });
      void cancelResumable(eventId, item.file).then(
        () => updateItem(item.id, { status: 'cancelled' }),
        reason => updateItem(item.id, { status: 'failed', error: reason instanceof Error ? reason.message : 'Could not cancel upload.' }),
      );
    }
  }
  const pending = batch.filter(item => item.status === 'waiting' || item.status === 'uploading' || item.status === 'processing');
  const totalBytes = batch.reduce((sum, item) => sum + item.file.size, 0);
  const completedBytes = batch.reduce((sum, item) => sum + item.bytes, 0);
  const canUpload = role === 'organizer' || role === 'contributor';

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('photo') as HTMLInputElement;
    const photo = input.files?.[0];
    if (!photo) return;
    if (photo.size > maxPhotoBytes) {
      setError('That JPEG is larger than the 25 MB limit.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const result = await uploadPhoto(eventId, photo);
      setMedia(current => [result.media, ...current]);
      form.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t upload that photo. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="photos" aria-labelledby="photos-heading">
      <div className="photos-heading">
        <div>
          <p className="section-label">Shared together</p>
          <h2 id="photos-heading">Photos</h2>
        </div>
        <span>{media.length} {media.length === 1 ? 'photo' : 'photos'}</span>
      </div>
      {canUpload ? (
        <form className="photo-upload" onSubmit={upload}>
          <label className="file-choice">
            <span>Choose one JPEG</span>
            <input name="photo" type="file" accept="image/jpeg,.jpg,.jpeg" required disabled={uploading} />
          </label>
          <button className="primary-button" type="submit" disabled={uploading}>
            {uploading ? 'Keeping the original safe…' : 'Add photo'}
          </button>
          <small>NAMI preserves the original bytes and makes a separate preview. Maximum 25 MB.</small>
        </form>
      ) : (
        <p className="viewer-note">You can view and download this event’s photos.</p>
      )}
      {canUpload ? (
        <div className="photo-upload batch-upload">
          <label className="file-choice">
            <span>Add several JPEGs</span>
            <input type="file" accept="image/jpeg,.jpg,.jpeg" multiple onChange={chooseBatch} />
          </label>
          <small>Uploads run one at a time. Keep this page open; if interrupted, choose the same files again to resume.</small>
          {batch.length > 0 ? <>
            <p aria-live="polite">{batch.filter(item => item.status === 'ready').length} of {batch.length} ready · {formatFileSize(completedBytes)} of {formatFileSize(totalBytes)} MB transferred</p>
            {pending.length > 0 && !paused.current ? <button type="button" className="secondary-button" onClick={pauseBatch}>Pause uploads</button> : null}
            {paused.current ? <button type="button" className="secondary-button" onClick={resumeBatch}>Resume uploads</button> : null}
            <ul className="batch-list">
              {batch.map(item => <li key={item.id}>
                <div><strong>{item.file.name}</strong><span>{item.status === 'failed' ? item.error : item.status} · {formatFileSize(item.bytes)} / {formatFileSize(item.file.size)} MB</span></div>
                <progress max={item.file.size} value={item.bytes} aria-label={`${item.file.name} progress`} />
                {item.status === 'failed' ? <button type="button" onClick={() => retry(item.id)}>Retry</button> : null}
                {['waiting', 'uploading', 'paused', 'failed'].includes(item.status) ? <button type="button" onClick={() => cancel(item)}>Cancel</button> : null}
              </li>)}
            </ul>
          </> : null}
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {media.length > 0 ? (
        <ul className="photo-grid">
          {media.map(photo => (
            <li key={photo.id}>
              <figure>
                <img
                  src={photo.previewPath}
                  alt={`Shared by ${photo.uploaderName}`}
                  width={photo.previewWidth}
                  height={photo.previewHeight}
                  loading="lazy"
                />
                <figcaption>
                  <span>Shared by <strong>{photo.uploaderName}</strong></span>
                  <a href={photo.downloadPath}>Download original · {formatFileSize(photo.sizeBytes)} MB</a>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      ) : <p className="empty-gallery">No photos yet. The first one will appear here.</p>}
    </section>
  );
}
