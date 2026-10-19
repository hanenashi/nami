import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { deleteMedia, type EventAccess, type NamiMedia } from './api.js';
import { PhotoViewer } from './PhotoViewer.js';
import { cancelResumable, uploadResumable, UploadFailure } from './resumable.js';

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
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const batchRef = useRef<BatchItem[]>([]);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const active = useRef<AbortController | null>(null);
  const running = useRef(false);
  const paused = useRef(false);
  const cancelled = useRef(new Set<string>());
  const canUpload = role === 'organizer' || role === 'contributor';

  useEffect(() => {
    paused.current = false;
    const stop = () => { paused.current = true; active.current?.abort(); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, []);

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
          if (result.duplicate) setDuplicateCount(current => current + 1);
          setMedia(current => current.some(photo => photo.id === result.media.id) ? current : [result.media, ...current]);
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
            updateItem(item.id, {
              status: 'failed',
              error: reason instanceof TypeError ? 'Connection interrupted. Retry this photo when ready.' :
                reason instanceof UploadFailure && reason.status === 429 ? 'Too many unfinished uploads. Retry or cancel older attempts first.' :
                  reason instanceof Error ? reason.message : 'Upload failed.',
            });
            if (reason instanceof TypeError || reason instanceof UploadFailure &&
              (reason.status === 429 || reason.status === 401 || reason.status === 403 || reason.status >= 500)) {
              paused.current = true;
            }
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
    setDuplicateCount(0);
    const selected = new Set(accepted.map(file => `${file.name}:${file.size}:${file.lastModified}`));
    batchRef.current = [
      ...batchRef.current.filter(item => item.status !== 'ready' && item.status !== 'cancelled' &&
        !(item.status === 'failed' && selected.has(`${item.file.name}:${item.file.size}:${item.file.lastModified}`))),
      ...accepted.map(file => ({ id: crypto.randomUUID(), file, status: 'waiting' as const, bytes: 0 })),
    ];
    paused.current = false;
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
  function retry(id: string) { cancelled.current.delete(id); paused.current = false; updateItem(id, { status: 'waiting' }); void runQueue(); }
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

  function toggleSelection(id: string) {
    setConfirmDelete(false);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function leaveSelection() { setSelecting(false); setSelected(new Set()); setConfirmDelete(false); }
  async function removeSelected() {
    setDeleting(true);
    setError('');
    try {
      await deleteMedia(eventId, [...selected]);
      setMedia(current => current.filter(photo => !selected.has(photo.id)));
      leaveSelection();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t remove those photos.');
      setConfirmDelete(false);
    } finally { setDeleting(false); }
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
        <div className="album-action-end">
          <span className="photo-count">{media.length} {media.length === 1 ? 'photo' : 'photos'}</span>
          {role === 'organizer' && media.length ? <button className="album-select-button" type="button" onClick={() => selecting ? leaveSelection() : setSelecting(true)}>{selecting ? 'Done' : 'Select'}</button> : null}
        </div>
      </div>
      {error ? <p className="form-error album-error" role="alert">{error}</p> : null}
      {duplicateCount > 0 ? <p className="duplicate-notice" role="status">{duplicateCount} {duplicateCount === 1 ? 'photo was' : 'photos were'} already in this album.</p> : null}
      {selecting ? <div className="photo-selection" aria-label="Photo selection">
        <span>{selected.size} selected</span>
        <div className="photo-selection-actions">
          <button type="button" onClick={() => { setSelected(new Set(media.map(photo => photo.id))); setConfirmDelete(false); }}>All</button>
          <button type="button" onClick={() => { setSelected(new Set()); setConfirmDelete(false); }}>None</button>
          <button type="button" onClick={() => { setSelected(current => new Set(media.filter(photo => !current.has(photo.id)).map(photo => photo.id))); setConfirmDelete(false); }}>Reverse</button>
        </div>
        {selected.size ? <button className="remove-photos" type="button" onClick={() => setConfirmDelete(true)}>Remove selected</button> : null}
      </div> : null}
      {confirmDelete ? <div className="delete-confirm" role="group" aria-label="Confirm photo removal">
        <p>Remove {selected.size} {selected.size === 1 ? 'photo' : 'photos'} from this event? This cannot be undone.</p>
        <button className="remove-photos" type="button" disabled={deleting} onClick={() => void removeSelected()}>{deleting ? 'Removing…' : `Yes, remove ${selected.size}`}</button>
        <button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Keep photos</button>
      </div> : null}
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
              {paused.current && failedCount === 0 ? <button type="button" className="secondary-button" onClick={resumeBatch}>Resume uploads</button> : null}
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
              <button className={`photo-tile${selecting ? ' is-selecting' : ''}${selected.has(photo.id) ? ' is-selected' : ''}`} type="button"
                aria-label={selecting ? `Select photo ${index + 1} of ${media.length}` : `Open photo ${index + 1} of ${media.length}, shared by ${photo.uploaderName}`}
                aria-pressed={selecting ? selected.has(photo.id) : undefined}
                onClick={event => selecting ? toggleSelection(photo.id) : openPhoto(index, event.currentTarget)}>
                <img src={photo.previewPath} alt="" width={photo.previewWidth} height={photo.previewHeight} loading="lazy" />
                {selecting ? <span className="selection-mark" aria-hidden="true">{selected.has(photo.id) ? '✓' : ''}</span> : null}
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
