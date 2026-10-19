import { useState, type FormEvent } from 'react';
import { uploadPhoto, type EventAccess, type NamiMedia } from './api.js';

const maxPhotoBytes = 25 * 1024 * 1024;

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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
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
