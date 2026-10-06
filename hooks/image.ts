// Image helpers shared by the ARCH diagram and the prompt's pasted-image preview. Pure functions.

export type Size = { width: number; height: number }

/** PNG width and height: the IHDR chunk sits at bytes 16-23, big-endian. Returns undefined for non-PNG data. */
export const pngSize = (base64: string): Size | undefined => {
  const bytes = Uint8Array.from(atob(base64.slice(0, 32)), c => c.charCodeAt(0))
  if (bytes.length < 24 || String.fromCharCode(...bytes.slice(1, 4)) !== 'PNG') return undefined
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}
