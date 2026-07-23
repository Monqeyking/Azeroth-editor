param(
    [string]$InputCsv = "$PSScriptRoot\..\output\DBFilesClient\CharSections.pending-insert.csv",
    [string]$SourceDbc = "D:\CaioCore\Client\Data\Patch-B.MPQ\DBfilesclient\CharSections.dbc",
    [string]$OutputCsv = "$PSScriptRoot\..\output\DBFilesClient\CharSections.color2-replace-test.csv"
)

$rows = @(Import-Csv -LiteralPath $InputCsv)
$bytes = [IO.File]::ReadAllBytes($SourceDbc)
if ([Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'WDBC') { throw "Not a WDBC file: $SourceDbc" }
$recordCount = [BitConverter]::ToInt32($bytes, 4)
$recordSize = [BitConverter]::ToInt32($bytes, 12)
if ($recordSize -ne 40) { throw "Unexpected CharSections record size: $recordSize" }

$color2 = @{}
for ($index = 0; $index -lt $recordCount; $index++) {
    $offset = 20 + ($index * $recordSize)
    $values = for ($field = 0; $field -lt 10; $field++) { [BitConverter]::ToUInt32($bytes, $offset + ($field * 4)) }
    if ($values[1] -eq 12 -and $values[2] -eq 0 -and $values[9] -eq 2) {
        $key = "$($values[1]):$($values[2]):$($values[3]):$($values[7]):$($values[8])"
        if ($color2.ContainsKey($key)) { throw "Duplicate Color 2 slot: $key" }
        $color2[$key] = $values[0]
    }
}

$out = foreach ($row in $rows) {
    if ([int]$row.ColorIndex -ne 8) { throw "Input contains non-Color 8 row: $($row.ID)" }
    $key = "$($row.RaceID):$($row.SexID):$($row.BaseSection):$($row.Flags):$($row.VariationIndex)"
    if (-not $color2.ContainsKey($key)) { throw "No matching Color 2 slot: $key" }
    [pscustomobject]@{
        ID = $color2[$key]
        RaceID = $row.RaceID
        SexID = $row.SexID
        BaseSection = $row.BaseSection
        TextureName_1 = $row.TextureName_1
        TextureName_2 = $row.TextureName_2
        TextureName_3 = $row.TextureName_3
        Flags = $row.Flags
        VariationIndex = $row.VariationIndex
        ColorIndex = 2
    }
}

if (@($out).Count -ne 34) { throw "Expected 34 Color 8 rows, found $(@($out).Count)" }
$out | Export-Csv -LiteralPath $OutputCsv -NoTypeInformation -Encoding utf8
Write-Output "Wrote $(@($out).Count) replacement rows to $OutputCsv"
