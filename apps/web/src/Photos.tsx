import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { type EventAccess, type NamiMedia } from './api.js';
import { PhotoViewer } from './PhotoViewer.js';
import { cancelResumable, uploadResumable } from './resumable.js';

const maxPhotoBytes = 25 * 1024 * 1024;

type BatchItem = {
  id: string;
  file: File;
  status: 'waiting' | 'uploading' | 'processing' | 'paused' | 'failed' | 'ready' | 'cancelled';
  bytes: number;
  error?: string;
};

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 0.1) return '<0.1';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(megabytes);
}

export function EventPhotos({ eventId, role, initialMedia }: {
  eventId: string;
  role: EventAccess['role'];
  initialMedia: NamiMedia[];
}) {
  const [media, setMedia] = useState(initialMedia);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const batchRef = useRef<BatchItem[]>([]);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  const paused = useRef(false);
  const cancelled = useRef(new Set<string>());
  const canUpload = role === 'organizer' || role === 'contributor';

  useEffect(() => () => active.current?.abort(), []);

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
  function choosePhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const accepted = files.filter(file => /\.jpe?g$/i.test(file.name) && file.size > 0 && file.size <= maxPhotoBytes);
    if (accepted.length !== files.length) setError('Choose JPEG photos up to 25 MB each.');
    else setError('');
    batchRef.current = [
      ...batchRef.current.filter(item => item.status !== 'ready' && item.status !== 'cancelled'),
      ...accepted.map(file => ({ id: crypto.randomUUID(), file, status: 'waiting' as const, bytes: 0 })),
    ];
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
  const visibleBatch = batch.filter(item => item.status !== 'ready' && item.status !== 'cancelled');
  const pendingCount = visibleBatch.filter(item => item.status === 'waiting' || item.status === 'uploading' || item.status === 'processing').length;
  const failedCount = visibleBatch.filter(item => item.status === 'failed').length;
  const totalBytes = batch.filter(item => item.status !== 'cancelled').reduce((sum, item) => sum + item.file.size, 0);
  const completedBytes = batch.filter(item => item.status !== 'cancelled').reduce((sum, item) => sum + item.bytes, 0);

  function openPhoto(index: number, button: HTMLButtonElement) {
    openerRef.current = button;
    setViewerIndex(index);
  }
  function closePhoto() {
    setViewerIndex(null);
    requestAnimationFrame(() => openerRef.current?.focus({ preventScroll: true }));
  }

  return (
    <section className="photos" aria-labelledby="photos-heading">
      <h2 id="photos-heading" className="visually-hidden">Photos</h2>
      <div className="album-actions">
        {canUpload ? (
          <label className="add-photos-action">
            <span className="add-icon" aria-hidden="true">+</span>
            <span>Add photos</span>
            <input aria-label="Add photos" type="file" accept="image/jpeg,.jpg,.jpeg" multiple onChange={choosePhotos} />
          </label>
        ) : null}
        <span className="photo-count">{media.length} {media.length === 1 ? 'photo' : 'photos'}</span>
      </div>
      {error ? <p className="form-error album-error" role="alert">{error}</p> : null}
      {visibleBatch.length > 0 ? (
        <div className="upload-progress">
          <details open={failedCount > 0 ? true : undefined}>
            <summary>
              <span>{failedCount ? `${failedCount} ${failedCount === 1 ? 'photo needs' : 'photos need'} attention` : paused.current ? 'Uploads paused' : pendingCount ? `Adding photos · ${batch.filter(item => item.status === 'ready').length} of ${batch.length} ready` : 'Uploads paused'}</span>
              <span className="progress-detail">Details</span>
            </summary>
            <div className="upload-progress-body">
              <p>Keep this page open while adding photos. Select the same files again after an interruption to resume.</p>
              {pendingCount > 0 && !paused.current ? <button type="button" className="secondary-button" onClick={pauseBatch}>Pause uploads</button> : null}
              {paused.current ? <button type="button" className="secondary-button" onClick={resumeBatch}>Resume uploads</button> : null}
              <ul className="batch-list">
                {visibleBatch.map(item => <li key={item.id}>
                  <div><strong>{item.file.name}</strong><span>{item.status === 'failed' ? item.error : item.status} · {formatFileSize(item.bytes)} / {formatFileSize(item.file.size)} MB</span></div>
                  <progress max={item.file.size} value={item.bytes} aria-label={`${item.file.name} progress`} />
                  {item.status === 'failed' ? <button type="button" onClick={() => retry(item.id)}>Retry</button> : null}
                  {['waiting', 'uploading', 'paused', 'failed'].includes(item.status) ? <button type="button" onClick={() => cancel(item)}>Cancel</button> : null}
                </li>)}
              </ul>
            </div>
          </details>
          <progress max={totalBytes || 1} value={completedBytes} aria-label="Total upload progress" />
        </div>
      ) : null}
      {media.length > 0 ? (
        <ul className="photo-grid">
          {media.map((photo, index) => (
            <li key={photo.id}>
              <button className="photo-tile" type="button" aria-label={`Open photo ${index + 1} of ${media.length}, shared by ${photo.uploaderName}`} onClick={event => openPhoto(index, event.currentTarget)}>
                <img src={photo.previewPath} alt="" width={photo.previewWidth} height={photo.previewHeight} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="empty-gallery">{canUpload ? 'No photos yet. Add the first one to this album.' : 'No photos yet.'}</p>}
      {viewerIndex !== null ? (
        <PhotoViewer media={media} index={viewerIndex} onIndexChange={setViewerIndex} onClose={closePhoto} />
      ) : null}
    </section>
  );
}
