#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Profile,
    [Parameter(Mandatory)][string]$ManifestPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ManifestSHA256,
    [switch]$Tools,
    [switch]$HostOnly,
    [string]$BindingSHA256,
    [pscredential]$GuestAdministrator
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
# Fixed process exits carry the failed stage across RunAs without a writable
# result file. The ordinary parent reports the same stage to the workbench.
$maintenanceFailures=@{
    1=@('FAILED','Windows maintenance did not complete. Start the original action again from Cage; if it still fails, export a diagnostics bundle.')
    41=@('VALIDATION','The Windows environment binding or component manifest failed validation. Start the original action again; if the component package still cannot be verified, reinstall the full Cage app.')
    42=@('HOST_MANAGER','Windows system management helper installation did not complete. Retry repairing the system helper; if it still fails, check the system services or security software logs and export a diagnostics bundle.')
    43=@('GUEST_CONNECTION','Windows guest connection did not complete. Start and sign in to the bound guest, then retry with that guest administrator account.')
    44=@('GUEST_COMPONENTS','Windows guest component installation did not complete. Keep the original guest running and retry syncing environment components; if it still fails, export a diagnostics bundle.')
    45=@('HOST_RELAY','Windows host connection component update did not complete. Close any program using the connection components, then retry syncing environment components.')
    46=@('PACKAGE_PREPARATION','Windows component package preparation did not complete. Check the app directory and system drive space and try again; when updating tools, also check the selected proxy.')
    47=@('AUTHORIZATION','The Windows administrator authorization window could not be opened. Start the action again from Cage on this computer, using a Windows account that can complete administrator authorization.')
    48=@('AUTHORIZATION_CANCELED','Windows administrator authorization was canceled. Start the original action again and confirm in the Windows system authorization window.')
}
$maintenanceExitCode=41
trap {
    if ($maintenanceExitCode -eq 47) {
        for ($cause=$_.Exception; $cause; $cause=$cause.InnerException) {
            if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) { $maintenanceExitCode=48; break }
        }
    }
    if (!$maintenanceFailures.ContainsKey($maintenanceExitCode)) { $maintenanceExitCode=1 }
    $failure=$maintenanceFailures[$maintenanceExitCode]
    [Console]::Error.WriteLine(('CAGE_WINDOWS_MAINTENANCE_'+$failure[0]+' '+$failure[1]))
    [Console]::Error.WriteLine($_.Exception.Message)
    exit $maintenanceExitCode
}

function Invoke-CageMaintenanceElevation([string]$ScriptPath,[hashtable]$Parameters) {
    $payload=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Parameters|ConvertTo-Json -Compress)))
    $script=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ScriptPath))
    $command='$ErrorActionPreference=''Stop'';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('''+$payload+'''))|ConvertFrom-Json;$a=@{};$p.PSObject.Properties|ForEach-Object{$a[$_.Name]=$_.Value};$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('''+$script+'''));try{$global:LASTEXITCODE=0;& $s @a;exit $LASTEXITCODE}catch{Write-Error $_ -ErrorAction Continue;exit 1}'
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process=Start-Process -FilePath (Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell/v1.0/powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','RemoteSigned','-EncodedCommand',$encoded) -Verb RunAs -PassThru
    try {
        # Retain the native handle before waiting. Windows PowerShell 5.1 can
        # otherwise return a null ExitCode after a successful child exit.
        $null=$process.Handle
        $process.WaitForExit()
        if ($null -eq $process.ExitCode) { throw 'Could not read the exit status of the system authorization process. Start the action again.' }
        return [int]$process.ExitCode
    } finally { $process.Dispose() }
}

$bindingPath=Join-Path $Profile 'windows-guest.json'
$item=Get-Item -LiteralPath $bindingPath -Force
if ($item -isnot [IO.FileInfo] -or $item.Length -gt 16384 -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The bound Windows environment record could not be verified.' }
$bindingHash=(Get-FileHash -LiteralPath $bindingPath -Algorithm SHA256).Hash
if ($BindingSHA256 -and $BindingSHA256 -ne $bindingHash) { throw 'The Windows environment binding has changed. Start the update again.' }
if ((Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash -ne $ManifestSHA256) { throw 'The component manifest has changed. Start the update again.' }
$maintenanceExitCode=47
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (![Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $parameters=@{Profile=$Profile;ManifestPath=$ManifestPath;ManifestSHA256=$ManifestSHA256;BindingSHA256=$bindingHash;Tools=[bool]$Tools;HostOnly=[bool]$HostOnly}
    $maintenanceExitCode=Invoke-CageMaintenanceElevation -ScriptPath $PSCommandPath -Parameters $parameters
    if ($maintenanceExitCode -ne 0) { throw 'The elevated Windows maintenance process did not complete.' }
    exit 0
}
$maintenanceExitCode=41
$binding=Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
if ($binding.version -ne 1 -or [guid]$binding.vm_id -eq [guid]::Empty) { throw 'The Windows guest binding could not be verified.' }
if (!$HostOnly) {
$maintenanceExitCode=43
$vm=Hyper-V\Get-VM -Id ([guid]$binding.vm_id)
if ($vm.State -ne 'Running') { throw 'Start and sign in to the bound Windows guest first.' }
$maintenanceExitCode=41
$disks=@($vm | Hyper-V\Get-VMHardDiskDrive)
$pairDirectory=[IO.Path]::GetDirectoryName($binding.relay_executable)
$stagedPairDirectory=Join-Path $binding.instance_directory 'cage-workbench\pair'
if ($binding.version -ne 1 -or $vm.Id -eq [guid]::Empty -or
    $binding.gui_user_sid -notmatch '^S-1-5-21-' -or @(Hyper-V\Get-VMNetworkAdapter -VM $vm).Count -ne 0 -or
    $disks.Count -ne 1 -or $disks[0].Path -ine (Join-Path $binding.instance_directory 'system.vhdx') -or
    ($pairDirectory -ine $stagedPairDirectory -and $pairDirectory -ine $item.Directory.FullName) -or
    $binding.relay_executable -ine (Join-Path $pairDirectory 'Cage.GuestClipboard.exe') -or
    $binding.pairing_file -ine (Join-Path $pairDirectory 'pairing.dpapi')) {
    throw 'The running Windows guest does not match the saved binding.'
}
for ($entry=Get-Item -LiteralPath $binding.relay_executable -Force; $entry; $entry=if ($entry -is [IO.FileInfo]) {$entry.Directory} else {$entry.Parent}) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The host connection component path contains a file link.' }
}
} else {
    $vm=[pscustomobject]@{Id=[guid]$binding.vm_id}
}
$manifest=Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.protocol -ne 1 -or $manifest.system -cne 'windows-11' -or $manifest.revision -notmatch '^[a-f0-9]{64}$' -or @($manifest.files).Count -notin 1..10000) { throw 'The native component manifest is invalid.' }
$kit=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')+'\'
foreach ($entry in $manifest.files) {
    $source=[IO.Path]::GetFullPath((Join-Path $kit $entry.source))
    if (!$source.StartsWith($kit,[StringComparison]::OrdinalIgnoreCase) -or (Get-Item -LiteralPath $source -Force).Attributes -band [IO.FileAttributes]::ReparsePoint -or
        (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'The app component package has changed. Reinstall the full Cage app.' }
}
# The native host helper is part of the same checked component package. Update
# its fixed-VM service during the existing administrator-authorized maintenance.
# The protected registration supplies the original host user across UAC.
$managerBindingPath=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('Cage\HyperVManager\'+$vm.Id.ToString('D')+'\binding.json')
$managerBindingFile=Get-Item -LiteralPath $managerBindingPath -Force
if ($managerBindingFile.Attributes -band [IO.FileAttributes]::ReparsePoint -or $managerBindingFile.Length -gt 65536) { throw 'The Windows management helper registration file could not be verified.' }
$managerBinding=Get-Content -LiteralPath $managerBindingPath -Raw | ConvertFrom-Json
if ([guid]$managerBinding.vm_id -ne $vm.Id -or $managerBinding.host_sid -notmatch '^S-1-(5-21|12-1)-(\d+-){3}\d+$') { throw 'The Windows management helper user or guest identity does not match.' }
$managerPayload=Join-Path $kit 'payload/Cage.HyperVManager.exe'
$maintenanceExitCode=42
& (Join-Path $kit 'install-windows-host-manager.ps1') -VMId $vm.Id -HostSID $managerBinding.host_sid -PayloadExecutable $managerPayload -PayloadSHA256 (Get-FileHash -LiteralPath $managerPayload -Algorithm SHA256).Hash -Confirm:$false | Out-Null
if ($HostOnly) {
    Write-Output 'The Windows system management helper was restored. You can continue restoring the storage migration.'
    exit 0
}
$maintenanceExitCode=46
$work=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('Cage\ComponentMaintenance\'+$vm.Id.ToString('D'))
for ($parent=$work; $parent; $parent=[IO.Path]::GetDirectoryName($parent)) {
    if ((Test-Path -LiteralPath $parent) -and (Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The component maintenance directory contains a file link.' }
}
$null=New-Item -ItemType Directory -Path $work -Force
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
Set-Acl -LiteralPath $work -AclObject $acl
$lock=[IO.File]::Open((Join-Path $work 'maintenance.lock'),'OpenOrCreate','ReadWrite','None')
$stage=Join-Path $work ([guid]::NewGuid().ToString('N'))
$session=$null
$remote=$null
$completed=$false
try {
    $null=New-Item -ItemType Directory -Path $stage
    $files=Join-Path $stage 'files'
    $null=New-Item -ItemType Directory -Path $files
    foreach ($entry in $manifest.files) {
        if (!$entry.target) { continue }
        if ($entry.target -notmatch '^(bridge|network)/[^:]+$' -or $entry.target -match '(^|/)\.\.?(/|$)|\\') { throw 'The component install location is invalid.' }
        $target=Join-Path $files $entry.target
        $null=New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force
        Copy-Item -LiteralPath (Join-Path $kit $entry.source) -Destination $target
        if ((Get-FileHash -LiteralPath $target).Hash -ne $entry.installed_sha256) { throw 'The component digest after copying does not match.' }
    }
    [IO.File]::WriteAllText((Join-Path $stage 'native-components.json'),($manifest | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    $packages=Get-Content -LiteralPath (Join-Path $kit 'payload/windows-workbench-packages.json') -Raw | ConvertFrom-Json
    $cli=Get-Content -LiteralPath (Join-Path $kit 'payload/cli-dependencies.json') -Raw | ConvertFrom-Json
    if ($Tools) {
        . (Join-Path $kit 'windows-workbench-packages.ps1')
        $cache=Join-Path $work 'packages'
        $null=New-Item -ItemType Directory -Path $cache -Force
        Resolve-ClaudePackages $packages $cli $cache
        $downloads=@{}
        foreach ($spec in @($packages.PSObject.Properties)+@($cli.PSObject.Properties)) { $downloads[$spec.Name]=Get-PinnedPackage $spec.Value $cache }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $bridge=Join-Path $stage 'runtime'
        $null=New-Item -ItemType Directory -Path $bridge
        $archive=[IO.Compression.ZipFile]::OpenRead($downloads.node)
        try { [IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('node-v24.22.2-win-x64/node.exe'),(Join-Path $bridge 'node.exe')) } finally { $archive.Dispose() }
        Expand-PinnedTar $downloads.playwright (Join-Path $bridge 'playwright')
        Expand-PinnedTar $downloads.playwrightCore (Join-Path $bridge 'playwright/node_modules/playwright-core')
        [IO.Compression.ZipFile]::ExtractToDirectory($downloads.editorCLI,(Join-Path $bridge 'vscode-cli'))
        Expand-PinnedTar $downloads.editorServer (Join-Path $bridge 'vscode-server')
        [IO.File]::WriteAllText((Join-Path $bridge 'editor-runtime.json'),'{"commit":"261c84cb1eddf11235f9e2c921425e9663fbe556"}')
        $toolStage=Join-Path $stage 'tools'
        $null=New-Item -ItemType Directory -Path $toolStage
        foreach ($name in @('desktop','winfsp','sshfs','uv','python','claude','git','gh')) { Copy-Item -LiteralPath $downloads[$name] -Destination $toolStage }
        & (Join-Path $env:SystemRoot 'System32/tar.exe') -a -cf (Join-Path $toolStage 'extras.zip') -C $bridge .
        if ($LASTEXITCODE) { throw 'Could not prepare the verified environment tool package.' }
    }
    $maintenanceExitCode=43
    if (!$GuestAdministrator) { $GuestAdministrator=Get-Credential -Message 'Cage: enter the administrator account of the current Windows guest to update components.' }
    if (!$GuestAdministrator) { throw 'The Windows component update was canceled.' }
    $session=New-PSSession -VMId $vm.Id -Credential $GuestAdministrator
    $remote=Invoke-Command -Session $session -ArgumentList $vm.Id -ScriptBlock {
        param($expected)
        if ([guid](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Virtual Machine\Guest\Parameters').VirtualMachineId -ne $expected) { throw 'guest_identity_mismatch' }
        $path=Join-Path $env:ProgramFiles ('Cage Component Update\'+[guid]::NewGuid().ToString('N'))
        $null=New-Item -ItemType Directory -Path $path -Force
        $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        foreach ($sid in @('S-1-5-18','S-1-5-32-544')) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
        Set-Acl -LiteralPath $path -AclObject $acl
        $path
    }
    $maintenanceExitCode=44
    $archive=Join-Path $work ([guid]::NewGuid().ToString('N')+'.zip')
    try {
        $entries=@('files','native-components.json')
        if ($Tools) { $entries+='tools' }
        & (Join-Path $env:SystemRoot 'System32/tar.exe') -a -cf $archive -C $stage @entries
        if ($LASTEXITCODE) { throw 'Could not package the guest components.' }
        Copy-Item -LiteralPath $archive -Destination (Join-Path $remote 'update.zip') -ToSession $session
        $hash=(Get-FileHash -LiteralPath $archive).Hash
    } finally { if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive } }
    Copy-Item -LiteralPath (Join-Path $kit 'install-windows-workbench-components.ps1') -Destination $remote -ToSession $session
    Invoke-Command -Session $session -FilePath (Join-Path $kit 'update-windows-workbench-components.ps1') -ArgumentList $vm.Id,$binding.gui_user_sid,$remote,$hash,([bool]$Tools),($packages|ConvertTo-Json -Depth 6 -Compress),($cli|ConvertTo-Json -Depth 6 -Compress)
    # The host relay is an application file. Pairing bytes and the binding are retained.
    $maintenanceExitCode=45
    $relayStage=$binding.relay_executable+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        Copy-Item -LiteralPath (Join-Path $files 'bridge/Cage.GuestClipboard.exe') -Destination $relayStage
        Set-Acl -LiteralPath $relayStage -AclObject (Get-Acl -LiteralPath $binding.relay_executable)
        [IO.File]::Replace($relayStage,$binding.relay_executable,[Management.Automation.Language.NullString]::Value)
    } finally { if (Test-Path -LiteralPath $relayStage) { Remove-Item -LiteralPath $relayStage } }
    $maintenanceExitCode=41
    if (@(Hyper-V\Get-VMNetworkAdapter -VM (Hyper-V\Get-VM -Id $vm.Id)).Count -ne 0) { throw 'The guest network configuration changed during the update.' }
    $maintenanceExitCode=44
    $completed=$true
} finally {
    if ($session) {
        if ($remote -and $completed) { Invoke-Command -Session $session -ArgumentList $remote -ScriptBlock { param($path) Remove-Item -LiteralPath $path -Recurse -Force } -ErrorAction Continue }
        elseif ($remote) { Write-Warning ('Component recovery files are kept on the guest at '+$remote+'. Retrying continues with the original environment.') }
        Remove-PSSession $session
    }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    $lock.Dispose()
}
Write-Output 'Windows guest components passed file verification. The account, projects, and pairing data were kept.'
exit 0
