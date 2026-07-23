param(
  [string]$BasePath = 'D:\CaioCore\Client\Data\Patch-B.MPQ\DBfilesclient\CharSections.dbc',
  [string]$TargetPath = 'D:\CaioCore\Client\Data\Patch-C.MPQ\DBfilesclient\CharSections.dbc',
  [string]$BackupPath = 'D:\CaioCore Tools\azeroth-editor\output\diagnostics\CharSections.before-color2-reference-isolation.dbc'
)

function Read-Dbc($path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $count = [BitConverter]::ToUInt32($bytes, 4)
  $recordSize = [BitConverter]::ToUInt32($bytes, 12)
  $stringSize = [BitConverter]::ToUInt32($bytes, 16)
  $dataStart = 20
  $stringStart = $dataStart + $count * $recordSize
  $strings = $bytes[$stringStart..($stringStart + $stringSize - 1)]
  $offsets = @{}
  for ($i = 0; $i -lt $strings.Length;) {
    $end = $i
    while ($end -lt $strings.Length -and $strings[$end] -ne 0) { $end++ }
    $offsets[[Text.Encoding]::UTF8.GetString($strings[$i..($end - 1)])] = $i
    $i = $end + 1
  }
  [pscustomobject]@{ Bytes = $bytes; Count = $count; RecordSize = $recordSize; DataStart = $dataStart; Strings = $strings; Offsets = $offsets }
}

function Read-String($dbc, $offset) {
  if ($offset -eq 0) { return '' }
  $end = $offset
  while ($end -lt $dbc.Strings.Length -and $dbc.Strings[$end] -ne 0) { $end++ }
  [Text.Encoding]::UTF8.GetString($dbc.Strings[$offset..($end - 1)])
}

$base = Read-Dbc $BasePath
$target = Read-Dbc $TargetPath
$sourceSlots = @{}

for ($i = 0; $i -lt $base.Count; $i++) {
  $offset = $base.DataStart + $i * $base.RecordSize
  if ([BitConverter]::ToUInt32($base.Bytes, $offset + 4) -ne 12 -or [BitConverter]::ToUInt32($base.Bytes, $offset + 8) -ne 0 -or [BitConverter]::ToUInt32($base.Bytes, $offset + 36) -ne 2) { continue }
  $key = '{0}:{1}:{2}' -f [BitConverter]::ToUInt32($base.Bytes, $offset + 12), [BitConverter]::ToUInt32($base.Bytes, $offset + 28), [BitConverter]::ToUInt32($base.Bytes, $offset + 32)
  $sourceSlots[$key] = @(
    (Read-String $base ([BitConverter]::ToUInt32($base.Bytes, $offset + 16))),
    (Read-String $base ([BitConverter]::ToUInt32($base.Bytes, $offset + 20))),
    (Read-String $base ([BitConverter]::ToUInt32($base.Bytes, $offset + 24)))
  )
}

$parent = Split-Path -Parent $BackupPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
Copy-Item -LiteralPath $TargetPath -Destination $BackupPath -Force
$rows = 0
$changed = 0

for ($i = 0; $i -lt $target.Count; $i++) {
  $offset = $target.DataStart + $i * $target.RecordSize
  if ([BitConverter]::ToUInt32($target.Bytes, $offset + 4) -ne 12 -or [BitConverter]::ToUInt32($target.Bytes, $offset + 8) -ne 0 -or [BitConverter]::ToUInt32($target.Bytes, $offset + 36) -ne 8) { continue }
  $rows++
  $key = '{0}:{1}:{2}' -f [BitConverter]::ToUInt32($target.Bytes, $offset + 12), [BitConverter]::ToUInt32($target.Bytes, $offset + 28), [BitConverter]::ToUInt32($target.Bytes, $offset + 32)
  if (-not $sourceSlots.ContainsKey($key)) { throw "No Color 2 source slot for $key" }
  $textures = $sourceSlots[$key]
  for ($fieldIndex = 0; $fieldIndex -lt 3; $fieldIndex++) {
    $field = 16 + 4 * $fieldIndex
    $old = Read-String $target ([BitConverter]::ToUInt32($target.Bytes, $offset + $field))
    $new = $textures[$fieldIndex]
    if ($old -eq $new) { continue }
    if (-not $target.Offsets.ContainsKey($new)) { throw "Target string not present: $new" }
    [BitConverter]::GetBytes([uint32]$target.Offsets[$new]).CopyTo($target.Bytes, $offset + $field)
    $changed++
  }
}

if ($rows -ne 34) { throw "Expected 34 Color 8 rows, found $rows" }
[IO.File]::WriteAllBytes($TargetPath, $target.Bytes)
[pscustomobject]@{ Backup = $BackupPath; Rows = $rows; TextureFieldsChanged = $changed; Target = $TargetPath }
