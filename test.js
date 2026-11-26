// Pruebas locales (no necesitan teléfono): conversión y serialización del audio.
// Ejecutar: npm test
import fs from 'node:fs'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { probe, makeWebp, makeOpus, waveform } from './media.js'
import { proto, attachAudio, detachAudio, buildAudioBytes } from './whatsapp.js'
import protobuf from 'protobufjs'

const dir = './test-tmp'
fs.mkdirSync(dir, { recursive: true })
const ok = m => console.log('  ✔', m)

try {
  // 1. Video de prueba de 4 s con sonido, y otro sin sonido
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `${dir}/in.mp4`])
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x320:rate=30:duration=2', '-c:v', 'libx264', `${dir}/mute.mp4`])
  fs.writeFileSync(`${dir}/bad.mp4`, 'esto no es un video')

  const info = await probe(`${dir}/in.mp4`)
  assert(info.hasVideo && info.hasAudio && Math.abs(info.duration - 4) < 0.2)
  ok('ffprobe detecta video, audio y duración')
  assert.strictEqual((await probe(`${dir}/mute.mp4`)).hasAudio, false)
  ok('detecta archivo sin audio')
  await assert.rejects(probe(`${dir}/bad.mp4`))
  ok('rechaza archivo inválido')

  // 2. WebP
  const v = await makeWebp(`${dir}/in.mp4`, `${dir}/s.webp`, { start: 0.5, duration: 3, fit: 'fit' })
  const head = fs.readFileSync(`${dir}/s.webp`).subarray(0, 12).toString('latin1')
  assert(head.startsWith('RIFF') && head.endsWith('WEBP') && v.bytes <= 500 * 1024)
  const wbuf = fs.readFileSync(`${dir}/s.webp`)
  assert(wbuf.includes('ANIM') && wbuf.includes('VP8X'), 'el WebP debe ser animado')
  assert.strictEqual(wbuf.readUIntLE(24, 3) + 1, 512); assert.strictEqual(wbuf.readUIntLE(27, 3) + 1, 512)
  ok(`WebP animado 512x512, ${(v.bytes / 1024).toFixed(0)} KB (fps ${v.fps}, q ${v.quality})`)

  // 3. Opus
  await makeOpus(`${dir}/in.mp4`, `${dir}/s.ogg`, { start: 0.5, duration: 3, volume: 1 })
  const oi = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-print_format', 'json', `${dir}/s.ogg`]).toString())
  const a = oi.streams[0]
  assert.strictEqual(a.codec_name, 'opus'); assert.strictEqual(a.channels, 1); assert.strictEqual(a.sample_rate, '48000')
  assert(Math.abs(parseFloat(oi.format.duration) - 3) < 0.1, 'duración del audio = duración del sticker')
  ok(`Ogg/Opus mono 48 kHz, ${parseFloat(oi.format.duration).toFixed(2)} s (sincronizado con el WebP de 3 s)`)
  const wave = await waveform(`${dir}/s.ogg`)
  assert.strictEqual(wave.length, 64)
  ok('forma de onda de 64 barras')

  // 4. Serialización: el audio va en StickerMessage campo 26
  const fakeAudio = { url: 'https://mmg.whatsapp.net/x', fileSha256: Buffer.alloc(32, 1), fileLength: 1234,
    mediaKey: Buffer.alloc(32, 2), fileEncSha256: Buffer.alloc(32, 3), directPath: '/v/t62/x', mediaKeyTimestamp: 1700000000 }
  const audioBytes = buildAudioBytes(fakeAudio, 3, wave)
  const sticker = { url: 'https://mmg.whatsapp.net/s', fileSha256: Buffer.alloc(32, 9), mimetype: 'image/webp', isAnimated: true, width: 512, height: 512 }
  attachAudio(sticker.fileSha256, audioBytes)
  // Igual que en el envío real: deviceSentMessage envuelve al mensaje para mis otros dispositivos
  const encoded = proto.Message.encode({ deviceSentMessage: { destinationJid: 'x@s.whatsapp.net', message: { stickerMessage: sticker } } }).finish()
  const plain = proto.Message.encode({ stickerMessage: sticker }).finish()
  detachAudio(sticker.fileSha256)

  const readField = (buf, field) => {
    const r = protobuf.Reader.create(buf)
    while (r.pos < r.len) {
      const tag = r.uint32()
      if (tag >>> 3 === field && (tag & 7) === 2) return r.bytes()
      r.skipType(tag & 7)
    }
    return null
  }
  for (const [name, buf] of [['directo', plain], ['deviceSentMessage', readField(readField(encoded, 31), 2)]]) {
    const stickerBytes = readField(buf, 26)
    const embedded = readField(stickerBytes, 26)
    assert(embedded, 'falta el audio en el campo 26 (' + name + ')')
    const dec = proto.Message.AudioMessage.decode(embedded)
    assert.strictEqual(dec.mimetype, 'audio/ogg; codecs=opus'); assert.strictEqual(dec.seconds, 3); assert.strictEqual(dec.ptt, true)
    assert.strictEqual(dec.directPath, '/v/t62/x'); assert.strictEqual(dec.waveform.length, 64)
    const decSticker = proto.Message.StickerMessage.decode(stickerBytes)
    assert.strictEqual(decSticker.isAnimated, true)
    ok(`audio intacto dentro de StickerMessage.audioMessage (26), mensaje ${name}`)
  }
  const after = proto.Message.encode({ stickerMessage: sticker }).finish()
  assert.strictEqual(readField(readField(after, 26), 26), null)
  ok('el parche no afecta a otros stickers (sin audio registrado)')

  console.log('\nTodas las pruebas pasaron.')
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
