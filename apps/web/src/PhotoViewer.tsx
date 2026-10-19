import { useEffect, useRef, useState, type TouchEvent } from 'react';
import type { NamiMedia } from './api.js';

export function PhotoViewer({ media, index, onIndexChange, onClose }: {
  media: NamiMedia[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const closeButton = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; distance: number; scale: number; offsetX: number; offsetY: number } | null>(null);
  const lastTap = useRef(0);
  const lastTouchZoom = useRef(0);
  const photo = media[index];

  useEffect(() => {
    closeButton.current?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, []);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    gesture.current = null;
  }, [index]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (event.key === 'ArrowRight' && index < media.length - 1) onIndexChange(index + 1);
      if (event.key === 'Tab') {
        const dialog = document.querySelector<HTMLElement>('.photo-viewer');
        const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [index, media.length, onClose, onIndexChange]);

  useEffect(() => {
    for (const adjacent of [media[index - 1], media[index + 1]]) {
      if (adjacent) { const image = new Image(); image.src = adjacent.previewPath; }
    }
  }, [index, media]);

  function distance(event: TouchEvent) {
    const [a, b] = [event.touches[0], event.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function touchStart(event: TouchEvent) {
    gesture.current = {
      x: event.touches[0].clientX, y: event.touches[0].clientY,
      distance: event.touches.length > 1 ? distance(event) : 0,
      scale, offsetX: offset.x, offsetY: offset.y,
    };
  }
  function touchMove(event: TouchEvent) {
    const start = gesture.current;
    if (!start) return;
    if (event.touches.length > 1 && start.distance) {
      setScale(Math.min(4, Math.max(1, start.scale * distance(event) / start.distance)));
    } else if (event.touches.length === 1 && scale > 1) {
      setOffset({ x: start.offsetX + event.touches[0].clientX - start.x, y: start.offsetY + event.touches[0].clientY - start.y });
    }
  }
  function touchEnd(event: TouchEvent) {
    const start = gesture.current;
    if (!start || event.touches.length) return;
    const deltaX = event.changedTouches[0].clientX - start.x;
    const deltaY = event.changedTouches[0].clientY - start.y;
    if (start.distance === 0 && start.scale === 1 && Math.abs(deltaX) > 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      if (deltaX < 0 && index < media.length - 1) onIndexChange(index + 1);
      if (deltaX > 0 && index > 0) onIndexChange(index - 1);
      lastTap.current = 0;
    } else if (start.distance === 0 && Math.abs(deltaX) < 20 && Math.abs(deltaY) < 20) {
      const now = Date.now();
      if (now - lastTap.current < 300) { toggleZoom(); lastTouchZoom.current = now; lastTap.current = 0; }
      else lastTap.current = now;
    }
    gesture.current = null;
  }
  function toggleZoom() {
    setScale(current => current === 1 ? 2 : 1);
    setOffset({ x: 0, y: 0 });
  }

  return <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={`Photo ${index + 1} of ${media.length}`}>
    <div className="viewer-toolbar">
      <span>{index + 1} / {media.length}</span>
      <button ref={closeButton} type="button" onClick={onClose} aria-label="Close photo viewer">✕</button>
    </div>
    <div className="viewer-stage" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onDoubleClick={() => { if (Date.now() - lastTouchZoom.current > 500) toggleZoom(); }}>
      {index > 0 ? <button className="viewer-arrow viewer-previous" type="button" onClick={() => onIndexChange(index - 1)} aria-label="Previous photo">‹</button> : null}
      <img src={photo.previewPath} alt={`Shared by ${photo.uploaderName}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} draggable="false" />
      {index < media.length - 1 ? <button className="viewer-arrow viewer-next" type="button" onClick={() => onIndexChange(index + 1)} aria-label="Next photo">›</button> : null}
    </div>
    <div className="viewer-footer"><span>Shared by {photo.uploaderName}</span><a href={photo.downloadPath} download={photo.originalName}>Download original</a></div>
  </div>;
}
