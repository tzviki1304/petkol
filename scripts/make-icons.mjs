// Renders the פתקול logo into Android launcher icons (legacy + adaptive) and a splash image.
import { Resvg } from '@resvg/resvg-js'
import fs from 'fs'
import path from 'path'

const res = 'android/app/src/main/res'
const ACCENT = '#c2643f'
const sheet = (s = 1, dx = 0, dy = 0) => `
  <g transform="translate(${dx} ${dy}) scale(${s})">
    <path d="M18 14h20l9 9v25a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fffaf3"/>
    <path d="M38 14v6a3 3 0 0 0 3 3h6z" fill="#f0d9c9"/>
    <g stroke="${ACCENT}" stroke-width="3.2" stroke-linecap="round">
      <path d="M22 33v4"/><path d="M27 29v12"/><path d="M32 26v18"/><path d="M37 30v10"/><path d="M42 33v4"/>
    </g>
  </g>`
const legacy = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${round ? `<circle cx="32" cy="32" r="31" fill="${ACCENT}"/>` : `<rect x="2" y="2" width="60" height="60" rx="16" fill="${ACCENT}"/>`}
  ${sheet()}</svg>`
// adaptive foreground: 108dp canvas, safe zone is the middle 66dp
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${sheet(1.2, 15.6, 15.6)}</svg>`
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><rect width="108" height="108" fill="${ACCENT}"/></svg>`

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
function png(svg, size, out) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(size) } })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, r.render().asPng())
}
for (const [d, k] of Object.entries(dens)) {
  png(legacy(false), 48 * k, `${res}/mipmap-${d}/ic_launcher.png`)
  png(legacy(true), 48 * k, `${res}/mipmap-${d}/ic_launcher_round.png`)
  png(fg, 108 * k, `${res}/mipmap-${d}/ic_launcher_foreground.png`)
  png(bg, 108 * k, `${res}/mipmap-${d}/ic_launcher_background.png`)
}
png(legacy(false), 512, 'store/icon-512.png')
console.log('icons written')

// splash screens: cream page with the logo in the middle, same size as Capacitor's defaults
const splashSvg = (w, h) => {
  const s = Math.min(w, h) * 0.28
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="#f7f5f0"/>
  <g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 64})">
    <rect x="2" y="2" width="60" height="60" rx="16" fill="${ACCENT}"/>${sheet()}
  </g></svg>`
}
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const f = `${res}/${dir}/splash.png`
  if (!fs.existsSync(f)) continue
  const b = fs.readFileSync(f)
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
  fs.writeFileSync(f, new Resvg(splashSvg(w, h)).render().asPng())
}
console.log('splash written')
