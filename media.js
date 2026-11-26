// Conversión con FFmpeg: video/imagen -> WebP 512x512, audio -> Ogg/Opus mono 48 kHz.
// Basado en el enfoque de DavidRamirez206/whatsapp-sound-sticker-bot (MIT).
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'

const run = promisify(execFile)
const MAX_BYTES = 500 * 1024

async function ffmpeg(args) {
  await run('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 64 * 1024 * 1024 })
}

export async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const info = JSON.parse(stdout)
  const streams = info.streams || []
  return {
    duration: parseFloat(info.format?.duration) || 0,
    hasVideo: streams.some(s => s.codec_type === 'video'),
    hasAudio: streams.some(s => s.codec_type === 'audio'),
    isImage: /^(png_pipe|jpeg_pipe|image2|webp_pipe|bmp_pipe)$/.test(info.format?.format_name || '')
  }
}

// fit = encaja con bordes transparentes, fill = recorta al cuadrado (con zoom y posición 0..1)
export async function makeWebp(input, output, { start, duration, fit = 'fit', isImage, zoom = 1, x = 0.5, y = 0.5 }) {
  const size = Math.round(512 * zoom)
  const scale = fit === 'fill'
    ? `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=512:512:(iw-512)*${x}:(ih-512)*${y},format=rgba`
    : 'scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000'

  if (isImage) {
    await ffmpeg(['-i', input, '-vf', scale, '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '80', output])
    return { animated: false, bytes: fs.statSync(output).size }
  }

  // Baja FPS y calidad hasta quedar bajo 500 KB
  for (const fps of [15, 12, 10, 8, 6]) {
    for (const q of [60, 40, 25, 12, 5]) {
      await ffmpeg([
        '-ss', String(start), '-t', String(duration), '-i', input, '-an',
        '-vf', `fps=${fps},${scale}`,
        '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(q), '-compression_level', '4', '-loop', '0',
        output
      ])
      const bytes = fs.statSync(output).size
      if (bytes <= MAX_BYTES) return { animated: true, bytes, fps, quality: q }
    }
  }
  throw new Error('No se pudo comprimir el sticker bajo 500 KB. Probá con un recorte más corto.')
}

export async function makeOpus(input, output, { start, duration, volume = 1 }) {
  await ffmpeg([
    '-ss', String(start), '-t', String(duration), '-i', input, '-vn', '-map', '0:a:0',
    '-af', `volume=${volume},aresample=48000,apad=whole_dur=${duration}`,
    '-t', String(duration), '-ac', '1', '-ar', '48000',
    '-c:a', 'libopus', '-b:a', '32k', '-map_metadata', '-1', output
  ])
  return { bytes: fs.statSync(output).size }
}

// Forma de onda de 64 barras (0-100), como en las notas de voz
export async function waveform(file) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2))
  const bars = 64, per = Math.max(1, Math.floor(samples.length / bars))
  const out = []
  for (let i = 0; i < bars; i++) {
    let sum = 0
    for (let j = i * per; j < (i + 1) * per && j < samples.length; j++) sum += Math.abs(samples[j])
    out.push(sum / per)
  }
  const max = Math.max(...out, 1)
  return Uint8Array.from(out.map(v => Math.round((v / max) * 100)))
}
