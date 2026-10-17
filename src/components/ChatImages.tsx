import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ImageAttachment } from '../types'
export const imageSource = (image: ImageAttachment) => `zai-asset://attachment/${image.id}`
export function ImageStrip({ images, quote, preview, remove }: { images: ImageAttachment[]; quote: (image: ImageAttachment) => void; preview: (image: ImageAttachment) => void; remove?: (image: ImageAttachment) => void }) {
  return <div className="chat-images">{images.map((image) => <div className="chat-image-card" key={image.reference}>
    <button className="chat-image-preview" aria-label={`Ampliar ${image.reference}`} title={image.name} onClick={() => preview(image)}><img src={imageSource(image)} alt={image.name} loading="lazy" /><span>Imagen {image.reference.slice(6)}</span></button>
    <button className="image-cite" aria-label={`Citar ${image.reference}`} title={`Insertar @${image.reference} en el mensaje`} onClick={() => quote(image)}>Citar ↗</button>
    {remove && <button className="image-remove icon-button" aria-label={`Quitar ${image.reference}`} onClick={() => remove(image)}><X size={11} /></button>}
  </div>)}</div>
}
export function ImagePreview({ image, close }: { image: ImageAttachment; close: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); close() } }
    window.addEventListener('keydown', escape, true); return () => window.removeEventListener('keydown', escape, true)
  }, [close])
  return createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Imagen ${image.reference.slice(6)}`} onPointerDown={(e) => { if (e.target === e.currentTarget) close() }}><button className="icon-button" aria-label="Cerrar imagen" autoFocus onClick={close}><X size={20} /></button><img src={imageSource(image)} alt={image.name} /><p>@{image.reference} · {image.name} · {image.width} × {image.height}</p></div>, document.body)
}
