@echo off
REM Build obfuscated extension + start API / Web / Workers
cd /d "%~dp0"
node scripts\start-all.mjs %*
