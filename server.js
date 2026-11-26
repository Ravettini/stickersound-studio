import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { probe, makeWebp, makeOpus, waveform } from './media.js'
import * as wa from './whatsapp.js'

const PORT = 3000
const MAX_SECONDS = 10
for (const d of ['uploads', 'stickers']) fs.mkdirSync(d, { recursive: true })

const app = express()
const upload = multer({ dest: 'uploads', limits: { fileSize: 100 * 1024 * 1024 } })

// Bloquea pedidos de otros sitios web (solo se acepta la propia página)
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin
  if (req.method !== 'GET' && origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) {
    return res.status(403).json({ error: 'Origen no permitido' })
  }
  next()
})
app.use(express.static('public'))
app.use('/stickers', express.static('stickers'))
app.use(express.json())

app.get('/api/status', (req, res) => res.json(wa.state))
app.post('/api/connect', async (req, res) => { await wa.connect(); res.json(wa.state) })
app.post('/api/logout', async (req, res) => { await wa.logout(); res.json(wa.state) })

app.get('/api/stickers', (req, res) => {
  const list = fs.readdirSync('stickers').filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join('stickers', f), 'utf8')))
    .sort((a, b) => b.created - a.created)
  res.json(list)
})

app.post('/api/stickers/:id/send', async (req, res) => {
  try {
    const id = req.params.id
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('ID inválido')
    const meta = JSON.parse(fs.readFileSync(`stickers/${id}.json`, 'utf8'))
    const ogg = meta.audio ? `stickers/${id}.ogg` : null
    await wa.sendSoundSticker({
      webpPath: `stickers/${id}.webp`, oggPath: ogg, seconds: meta.seconds, animated: meta.animated,
      wave: ogg ? await waveform(ogg) : undefined
    })
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.delete('/api/stickers/:id', (req, res) => {
  const id = req.params.id
  if (!/^[a-f0-9]{16}$/.test(id)) return res.status(400).json({ error: 'ID inválido' })
  for (const ext of ['webp', 'ogg', 'json']) fs.rmSync(`stickers/${id}.${ext}`, { force: true })
  res.json({ ok: true })
})

// Crear (y opcionalmente enviar) un sticker
app.post('/api/stickers', upload.fields([{ name: 'media', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), async (req, res) => {
  const media = req.files?.media?.[0]
  const extAudio = req.files?.audio?.[0]
  try {
    if (!media) throw new Error('Falta el archivo')
    const start = Math.max(0, Number(req.body.start) || 0)
    let duration = Math.min(MAX_SECONDS, Math.max(0.5, Number(req.body.duration) || MAX_SECONDS))
    const volume = Math.min(3, Math.max(0, Number(req.body.volume) || 1))
    const fit = req.body.fit === 'fit' ? 'fit' : 'fill'
    const clamp = (v, lo, hi, d) => Number.isFinite(+v) && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d
    const zoom = clamp(req.body.zoom, 1, 4, 1), x = clamp(req.body.x, 0, 1, 0.5), y = clamp(req.body.y, 0, 1, 0.5)
    const send = req.body.send === 'true'

    const info = await probe(media.path).catch(() => { throw new Error('Archivo inválido o no soportado') })
    if (!info.hasVideo) throw new Error('El archivo no tiene imagen ni video')
    if (!info.isImage && info.duration) duration = Math.min(duration, Math.max(0.5, info.duration - start))

    let audioSrc = null, audioStart = start
    if (extAudio) {
      const ai = await probe(extAudio.path).catch(() => ({}))
      if (!ai.hasAudio) throw new Error('El archivo de audio no tiene sonido')
      audioSrc = extAudio.path; audioStart = 0
    } else if (info.hasAudio) {
      audioSrc = media.path
    }

    const id = crypto.randomBytes(8).toString('hex')
    const webp = `stickers/${id}.webp`, ogg = `stickers/${id}.ogg`
    const v = await makeWebp(media.path, webp, { start, duration, fit, isImage: info.isImage, zoom, x, y })
    if (audioSrc) await makeOpus(audioSrc, ogg, { start: audioStart, duration, volume })
    const seconds = Math.max(1, Math.round(duration))

    const meta = {
      id, name: (req.body.name || media.originalname || 'sticker').slice(0, 60), created: Date.now(),
      seconds, duration, animated: v.animated, audio: !!audioSrc,
      webpBytes: v.bytes, oggBytes: audioSrc ? fs.statSync(ogg).size : 0
    }
    fs.writeFileSync(`stickers/${id}.json`, JSON.stringify(meta))

    if (send) {
      await wa.sendSoundSticker({
        webpPath: webp, oggPath: audioSrc ? ogg : null, seconds, animated: v.animated,
        wave: audioSrc ? await waveform(ogg) : undefined
      })
    }
    res.json({ ...meta, sent: send, warning: audioSrc ? null : 'El archivo no tiene audio: se creó un sticker sin sonido.' })
  } catch (e) {
    res.status(400).json({ error: e.message })
  } finally {
    for (const f of [media, extAudio]) if (f) fs.rmSync(f.path, { force: true })
  }
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`StickerSound Studio en http://localhost:${PORT}`)
  if (wa.hasSession()) wa.connect() // reconecta con la sesión guardada
})
