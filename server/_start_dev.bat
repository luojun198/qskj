@echo off
set SCHEMA_DIR=src/db
set NODE_OPTIONS=--import tsx/esm
node --import tsx/esm src/index.ts
pause
