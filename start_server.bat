@echo off
chcp 65001 > nul
echo ========================================================
echo   Генератор звітів з лабораторних робіт коледжу
echo ========================================================
echo Запуск локального веб-сервера на http://localhost:8080/
start http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
pause
