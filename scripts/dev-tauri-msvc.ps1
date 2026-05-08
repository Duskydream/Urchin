$ErrorActionPreference = 'Stop'

$vsRoot = 'C:\Program Files\Microsoft Visual Studio\18\Community'
$msvcRoot = Join-Path $vsRoot 'VC\Tools\MSVC'
$msvcVersion = Get-ChildItem -LiteralPath $msvcRoot -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $msvcVersion) {
  throw "未找到 MSVC 工具链目录：$msvcRoot"
}

$sdkLibVersion = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\Lib' -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'um\x64\kernel32.lib') } |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $sdkLibVersion) {
  throw '未找到 Windows SDK Lib 目录中的 kernel32.lib'
}

$sdkIncludeVersion = Get-ChildItem -LiteralPath 'C:\Program Files (x86)\Windows Kits\10\Include' -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'um\windows.h') } |
  Sort-Object Name -Descending |
  Select-Object -First 1

if (-not $sdkIncludeVersion) {
  throw '未找到 Windows SDK Include 目录中的 windows.h'
}

$msvcPath = $msvcVersion.FullName
$sdkLibPath = $sdkLibVersion.FullName
$sdkIncludePath = $sdkIncludeVersion.FullName

$env:PATH = @(
  (Join-Path $msvcPath 'bin\Hostx64\x64')
  $env:PATH
) -join ';'

$env:LIB = @(
  (Join-Path $msvcPath 'lib\x64')
  (Join-Path $sdkLibPath 'um\x64')
  (Join-Path $sdkLibPath 'ucrt\x64')
  $env:LIB
) -join ';'

$env:INCLUDE = @(
  (Join-Path $msvcPath 'include')
  (Join-Path $sdkIncludePath 'ucrt')
  (Join-Path $sdkIncludePath 'um')
  (Join-Path $sdkIncludePath 'shared')
  (Join-Path $sdkIncludePath 'winrt')
  (Join-Path $sdkIncludePath 'cppwinrt')
  $env:INCLUDE
) -join ';'

npm run tauri dev
