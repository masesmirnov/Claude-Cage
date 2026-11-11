# Records only the files verified in this fixed guest after installation.
param([guid]$VMId,[string]$GUIUserSID,[string]$ManifestJSON)
$ErrorActionPreference='Stop'
if ([guid](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Virtual Machine\Guest\Parameters').VirtualMachineId -ne $VMId -or
    $GUIUserSID -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or [Text.Encoding]::UTF8.GetByteCount($ManifestJSON) -gt 4MB) {
    throw 'The component version record does not match the guest identity.'
}
$manifest=$ManifestJSON|ConvertFrom-Json
if ($manifest.protocol -ne 1 -or $manifest.system -cne 'windows-11' -or $manifest.revision -notmatch '^[a-f0-9]{64}$' -or
    @($manifest.files).Count -lt 1 -or @($manifest.files).Count -gt 10000) { throw 'The component version manifest is invalid.' }
$roots=@{bridge=(Join-Path $env:ProgramFiles ('Cage Guest Bridge\'+$VMId));network=(Join-Path $env:ProgramFiles ('Cage Guest Network\'+$VMId))}
$seen=@{}
foreach ($entry in $manifest.files) {
    if (!$entry.target) { continue }
    if ($entry.target -notmatch '^(bridge|network)/[^:\\]+$' -or $entry.target -match '(^|/)\.\.?(/|$)' -or
        $entry.installed_sha256 -notmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($entry.target)) { throw 'A component file record is invalid.' }
    $seen[$entry.target]=$true
    $parts=$entry.target -split '/',2
    $file=Join-Path $roots[$parts[0]] $parts[1]
    $item=Get-Item -LiteralPath $file -Force
    if ($item -isnot [IO.FileInfo]) { throw 'An installed component file is missing. Continue syncing environment components.' }
    for ($parent=$item; $parent; $parent=if($parent -is [IO.FileInfo]){$parent.Directory}else{$parent.Parent}) {
        if ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The component install directory contains a file link.' }
    }
    if ((Get-FileHash -LiteralPath $file).Hash -ne $entry.installed_sha256) { throw 'The installed components do not match the current app version. Continue syncing environment components.' }
}
if (!$seen.Count) { throw 'The component manifest has no install files.' }
$target=Join-Path $roots.bridge 'native-components.json'
if (Test-Path -LiteralPath $target) {
    $old=Get-Item -LiteralPath $target -Force
    if ($old -isnot [IO.FileInfo] -or $old.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The existing component record cannot be updated safely.' }
}
$temporary=Join-Path $roots.bridge ('native-components.'+[guid]::NewGuid().ToString('N')+'.json')
try {
    $file=[IO.File]::Open($temporary,'CreateNew','Write','None')
    try {
        $bytes=[Text.UTF8Encoding]::new($false).GetBytes($ManifestJSON)
        $file.Write($bytes,0,$bytes.Length)
        $file.Flush($true)
    } finally { $file.Dispose() }
    $acl=[Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($GUIUserSID),'ReadAndExecute','Allow'))
    Set-Acl -LiteralPath $temporary -AclObject $acl
    if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temporary,$target,[Management.Automation.Language.NullString]::Value) }
    else { [IO.File]::Move($temporary,$target) }
} finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}
