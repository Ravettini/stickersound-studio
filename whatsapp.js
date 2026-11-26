// Conexión con WhatsApp (Baileys) y envío de stickers con audio nativo.
// Baileys 7.0.0-rc14 no define StickerMessage.audioMessage (campo 26), así que
// lo agregamos al codificar. Técnica tomada de DavidRamirez206/whatsapp-sound-sticker-bot (MIT).
import makeWASocket, {
  useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers,
  prepareWAMessageMedia, generateWAMessageFromContent, jidNormalizedUser, proto
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import pino from 'pino'
import fs from 'node:fs'

export { proto }
const AUTH_DIR = './auth'
const AUDIO_MIME = 'audio/ogg; codecs=opus'

// ---- Parche: StickerMessage.audioMessage = 26 ----
const STICKER_AUDIO_TAG = (26 << 3) | 2 // 210
const pendingAudio = new Map()
const keyOf = sha => Buffer.from(sha).toString('base64')

export function installStickerAudioPatch() {
  const SM = proto.Message.StickerMessage
  if (SM.encode.__audioPatched) return
  const original = SM.encode
  const patched = function (message, writer) {
    const w = original.call(this, message, writer)
    const audio = message?.fileSha256 && pendingAudio.get(keyOf(message.fileSha256))
    if (audio) w.uint32(STICKER_AUDIO_TAG).bytes(audio)
    return w
  }
  patched.__audioPatched = true
  SM.encode = patched
}
export const attachAudio = (sha, bytes) => pendingAudio.set(keyOf(sha), bytes)
export const detachAudio = sha => pendingAudio.delete(keyOf(sha))
installStickerAudioPatch()

// ---- Estado de conexión ----
export const state = { status: 'desconectado', qr: null, me: null }
let sock = null
let connecting = false

export async function connect() {
  if (sock || connecting) return
  connecting = true
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  state.status = 'conectando'
  sock = makeWASocket({
    version,
    auth,
    browser: Browsers.windows('Desktop'),
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false
  })
  connecting = false
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
    if (qr) {
      state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 300 })
      state.status = 'esperando QR'
    }
    if (connection === 'open') {
      state.qr = null
      state.status = 'conectado'
      state.me = jidNormalizedUser(sock.user.id)
      console.log('WhatsApp conectado:', state.me.split('@')[0])
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      sock = null
      state.qr = null
      state.me = null
      if (code === DisconnectReason.loggedOut) {
        state.status = 'desconectado'
        fs.rmSync(AUTH_DIR, { recursive: true, force: true })
        console.log('Sesión cerrada desde el teléfono.')
      } else if (!manualClose) {
        state.status = 'reconectando'
        setTimeout(connect, 2000)
      } else {
        state.status = 'desconectado'
      }
      manualClose = false
    }
  })
}

let manualClose = false
export async function logout() {
  manualClose = true
  try { await sock?.logout() } catch {}
  try { sock?.end() } catch {}
  sock = null
  fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  Object.assign(state, { status: 'desconectado', qr: null, me: null })
}

export const hasSession = () => fs.existsSync(`${AUTH_DIR}/creds.json`)

// ---- Construcción del mensaje ----
export function buildAudioBytes(audio, seconds, wave) {
  return proto.Message.AudioMessage.encode(proto.Message.AudioMessage.create({
    url: audio.url,
    mimetype: AUDIO_MIME,
    fileSha256: audio.fileSha256,
    fileLength: audio.fileLength,
    seconds,
    ptt: true,
    mediaKey: audio.mediaKey,
    fileEncSha256: audio.fileEncSha256,
    directPath: audio.directPath,
    mediaKeyTimestamp: audio.mediaKeyTimestamp || Math.floor(Date.now() / 1000),
    waveform: wave
  })).finish()
}

export async function sendSoundSticker({ webpPath, oggPath, seconds, animated, wave }) {
  if (state.status !== 'conectado' || !sock) throw new Error('WhatsApp no está conectado')
  const jid = state.me // chat conmigo mismo
  const up = { upload: sock.waUploadToServer }

  const audio = oggPath
    ? (await prepareWAMessageMedia({ audio: fs.readFileSync(oggPath), mimetype: AUDIO_MIME, seconds }, up)).audioMessage
    : null
  const sticker = (await prepareWAMessageMedia({ sticker: fs.readFileSync(webpPath) }, up)).stickerMessage
  sticker.isAnimated = animated
  sticker.width = 512
  sticker.height = 512

  if (audio) attachAudio(sticker.fileSha256, buildAudioBytes(audio, seconds, wave))
  try {
    const msg = generateWAMessageFromContent(jid, { stickerMessage: sticker }, { userJid: sock.user.id })
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
    return msg.key.id
  } finally {
    if (audio) detachAudio(sticker.fileSha256)
  }
}
