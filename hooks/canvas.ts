// Character-cell canvas: braille sub-pixels (2×4), a text layer and a background layer, output as Raster cells. Used by the Map tab.
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
const DEFAULT = 0x01000000

export const rgb = (hex: string) => parseInt(hex.slice(1, 7), 16)
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a), y = rgb(b)
  const c = (s: number) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * Math.max(0, Math.min(1, t)))
  return '#' + [16, 8, 0].map(s => c(s).toString(16).padStart(2, '0')).join('')
}

export class Canvas {
  bits: Uint8Array
  fg: Uint32Array
  bg: Uint32Array
  text: Uint32Array
  constructor(public cols: number, public rows: number) {
    const n = cols * rows
    this.bits = new Uint8Array(n)
    this.fg = new Uint32Array(n).fill(DEFAULT)
    this.bg = new Uint32Array(n).fill(DEFAULT)
    this.text = new Uint32Array(n)
  }
  get w() { return this.cols * 2 }
  get h() { return this.rows * 4 }
  px(x: number, y: number, color: string) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y >> 2) * this.cols + (x >> 1)
    this.bits[i]! |= DOT[y & 3]![x & 1]!
    this.fg[i] = rgb(color)
  }
  line(x0: number, y0: number, x1: number, y1: number, color: string | ((t: number) => string), dash = 0) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
    for (let k = 0; k <= n; k++) {
      if (dash && Math.floor(k / dash) % 2) continue
      const t = k / n
      this.px(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, typeof color === 'string' ? color : color(t))
    }
  }
  ring(cx: number, cy: number, r: number, color: string, dash = 0) {
    const n = Math.max(12, Math.ceil(r * 6.3))
    for (let k = 0; k < n; k++) {
      if (dash && Math.floor(k / dash) % 2) continue
      const a = (k / n) * Math.PI * 2
      this.px(cx + Math.cos(a) * r, cy + Math.sin(a) * r, color)
    }
  }
  disc(cx: number, cy: number, r: number, color: string) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + 0.5) this.px(cx + x, cy + y, color)
  }
  /** Accepts only width-1 characters; anything else becomes ? (Raster rejects full-width characters). */
  write(col: number, row: number, s: string, fg: string, bg?: string) {
    if (row < 0 || row >= this.rows) return
    let c = Math.round(col)
    for (const ch of s) {
      if (c >= this.cols) break
      if (c >= 0) {
        const i = row * this.cols + c
        const cp = ch.codePointAt(0)!
        this.text[i] = cp >= 0x20 && cp < 0x7f ? cp : cp >= 0x2500 && cp < 0x2600 ? cp : 0x3f
        this.fg[i] = rgb(fg)
        if (bg) this.bg[i] = rgb(bg)
      }
      c++
    }
  }
  fill(col: number, row: number, w: number, h: number, bg: string) {
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++)
      if (r >= 0 && c >= 0 && r < this.rows && c < this.cols) this.bg[r * this.cols + c] = rgb(bg)
  }
  encode() {
    const n = this.cols * this.rows
    const words = new Uint32Array(n * 3)
    for (let i = 0; i < n; i++) {
      words[i * 3] = this.text[i] || (this.bits[i] ? 0x2800 | this.bits[i]! : 0x20)
      words[i * 3 + 1] = this.fg[i]!
      words[i * 3 + 2] = this.bg[i]!
    }
    return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
  }
}
