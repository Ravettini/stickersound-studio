@echo off
cd /d "%~dp0"
title StickerSound Studio

where node >nul 2>nul || (echo Falta Node.js. Instalalo desde https://nodejs.org ^(version LTS^) & pause & exit /b)
where ffmpeg >nul 2>nul || (echo Falta FFmpeg. Instalalo con:  winget install Gyan.FFmpeg  y volve a abrir esto. & pause & exit /b)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install || (pause & exit /b)
)

start "" http://localhost:3000
echo Cerra esta ventana para apagar el programa.
node server.js
pause
