$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

npm run dev -- --host 127.0.0.1 --port 5173
