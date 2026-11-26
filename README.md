# StickerSound Studio

Panel local para crear stickers de WhatsApp **con sonido** a partir de un video y enviártelos a tu propio chat. Todo corre en tu computadora: escaneás un QR, subís el video, recortás y listo.

## Requisitos

- Windows 10 u 11 (también funciona en macOS/Linux ejecutando `npm start`).
- [Node.js](https://nodejs.org) 22 o superior (versión LTS).
- [FFmpeg](https://ffmpeg.org). En Windows, desde una terminal:
  ```
  winget install Gyan.FFmpeg
  ```
  Después cerrá y volvé a abrir la terminal para que lo reconozca.

## Instalación

```
git clone https://github.com/Ravettini/stickersound-studio.git
cd stickersound-studio
npm install
```

En Windows podés saltearte `npm install`: `start.bat` lo hace solo la primera vez.

## Uso

1. **Iniciar:** doble clic en `start.bat` (o `npm start`). Se abre http://localhost:3000.
2. **Conectar WhatsApp:** tocá *Conectar WhatsApp* y escaneá el QR desde el celular en *WhatsApp → Dispositivos vinculados → Vincular dispositivo*. La sesión queda guardada: la próxima vez se conecta sola.
3. **Cargar el archivo:** arrastrá un video (MP4, MOV, WebM, MKV, AVI), un GIF o una imagen.
4. **Ajustar:**
   - *Inicio* y *Duración* (máximo 10 segundos).
   - *Volumen*.
   - *Encuadre*: **Rellenar** ocupa todo el sticker. Usá el *zoom* (o la rueda del mouse) y arrastrá la vista previa para elegir el recorte. **Ajustar** muestra el video entero con fondo transparente.
   - *Reemplazar audio* (opcional): MP3, WAV, OGG o M4A.
5. **Crear y enviar a mi WhatsApp:** el sticker llega a tu chat contigo mismo. Tocalo para escucharlo, guardalo en favoritos y usalo donde quieras.

En **Mis stickers** quedan todos los que creaste. Desde ahí podés escucharlos, reenviarlos, descargarlos o borrarlos.

Para apagar el programa, cerrá la ventana negra de `start.bat`. Para desvincularlo, usá *Cerrar sesión*: también borra las credenciales guardadas.

## Pruebas

```
npm test
```

Prueba la conversión de video y audio con FFmpeg y que el audio quede bien incrustado en el mensaje del sticker. No necesita el celular.

## Cómo funciona

- `media.js`: FFmpeg genera un WebP animado de 512×512 de menos de 500 KB (si hace falta, baja los FPS y la calidad) y un Ogg/Opus mono a 48 kHz con la misma duración.
- `whatsapp.js`: usa [Baileys](https://github.com/WhiskeySockets/Baileys) `7.0.0-rc14` (versión fija). Sube los dos archivos con `prepareWAMessageMedia` y envía un `stickerMessage` con el audio incrustado en `StickerMessage.audioMessage` (campo protobuf 26). Baileys todavía no define ese campo, así que se agrega en tiempo de ejecución al codificar, sin tocar `node_modules`. La técnica está tomada de [DavidRamirez206/whatsapp-sound-sticker-bot](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot) (MIT).
- `server.js`: Express. Escucha solo en `localhost` y rechaza pedidos de otros sitios web.

## Limitaciones

- Si el WhatsApp de quien recibe todavía no soporta stickers con sonido, verá solo la animación.
- El sonido no va dentro del archivo `.webp`: descargar solo el WebP no lo conserva.
- La carpeta `auth/` contiene tu sesión de WhatsApp. No la compartas ni la subas (ya está en `.gitignore`).

## Aviso

Baileys no es una API oficial de Meta y existe riesgo de suspensión de la cuenta. Usalo solo con tu propio número, sin envíos masivos ni spam. Este proyecto no está afiliado a WhatsApp ni a Meta.
