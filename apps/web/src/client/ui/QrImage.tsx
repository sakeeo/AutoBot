'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Draws a QR code in the browser (nothing is sent anywhere). */
export function QrImage({ text, alt, size = 220 }: { text: string; alt: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    QRCode.toString(text, { type: 'svg', margin: 1, width: size })
      .then((svg) => live && setSrc('data:image/svg+xml;utf8,' + encodeURIComponent(svg)))
      .catch(() => live && setSrc(null))
    return () => { live = false }
  }, [text, size])
  return src ? <img src={src} alt={alt} width={size} height={size} /> : <div style={{ width: size, height: size }} aria-hidden="true" />
}
