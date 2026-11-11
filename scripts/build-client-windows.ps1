#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$SkipUI,
    [switch]$IncludeWebViewRuntime,
    [string]$DependencyCache
)
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$repository = Split-Path $PSScriptRoot -Parent
$version = Get-CageVersion $repository
$go = Get-BuildCommand @('go')
$dotnet = Get-BuildCommand @('dotnet')
$node = Get-BuildCommand @('node')
$npm = Get-BuildCommand @('npm.cmd', 'npm')
$dependencies = Get-Content -LiteralPath (Join-Path $repository 'packaging/windows/dependencies.json') -Raw | ConvertFrom-Json
if (-not $DependencyCache) { $DependencyCache = Join-Path $repository '_output/windows-deps' }
$outputRoot = Join-Path $repository '_output/client-windows-amd64'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$id = [guid]::NewGuid().ToString('N')
$stage = Join-Path $outputRoot ('.stage-' + $id)
$destination = Join-Path $outputRoot ('build-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $id.Substring(0, 8))
$savedGoOS, $savedGoArch, $savedCGO = $env:GOOS, $env:GOARCH, $env:CGO_ENABLED
New-Item -ItemType Directory -Path $stage | Out-Null
Push-Location $repository
try {
    if (-not $SkipUI) {
        if (-not (Test-Path -LiteralPath 'ui/node_modules')) { Invoke-BuildTool $npm @('--prefix', 'ui', 'ci', '--no-audit', '--no-fund') }
        Invoke-BuildTool $npm @('--prefix', 'ui', 'run', 'build')
    }
    if (-not (Test-Path -LiteralPath 'internal/workbench/web/index.html')) { throw 'Build the UI before using -SkipUI.' }
    if ($SkipUI) { Invoke-BuildTool $node @('ui/scripts/verify-build.mjs') }
    $env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    $goDependencies = & $go 'list' '-deps' './cmd/cage-client'
    if ($LASTEXITCODE -ne 0 -or ($goDependencies -match 'internal/limaembed|github.com/lima-vm/lima/v2|github.com/Code-Hex/vz')) { throw 'Client dependency check failed or includes a virtual machine runtime.' }
    $result = Join-Path $stage 'result'
    $app = Join-Path $result 'app'
    $resources = Join-Path $app 'resources'
    New-Item -ItemType Directory -Path $resources -Force | Out-Null
    Invoke-BuildTool $go @('build', '-trimpath', '-ldflags', "-s -w -X github.com/sylvinus/agent-vm/internal/version.Version=$version", '-o', (Join-Path $resources 'cage.exe'), './cmd/cage-client')
    Invoke-BuildTool $dotnet @('publish', 'desktop/windows/Cage.Windows.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
        '-p:EnableWindowsTargeting=true', '-p:PublishSingleFile=true', '-p:RestoreLockedMode=true', "-p:Version=$version", "-p:InformationalVersion=$version", '-o', $app)
    Get-ChildItem -LiteralPath $app -File | Where-Object { $_.Extension -in @('.pdb', '.xml') } | Remove-Item -Force
    [IO.File]::WriteAllText((Join-Path $resources 'client-only'), '')
    [IO.File]::WriteAllText((Join-Path $app 'Cage.client-id'), 'io.github.lee-xeo.claude-cage-client')
    [IO.File]::WriteAllText((Join-Path $app 'version.txt'), $version)
    Invoke-BuildTool $node @('scripts/bundle-cloud-kit.mjs', $resources)
    Invoke-BuildTool $node @('scripts/collect-app-licenses.mjs', (Join-Path $resources 'licenses'))
    $assets = Get-Content -LiteralPath 'desktop/windows/obj/project.assets.json' -Raw | ConvertFrom-Json
    $nuget = @($assets.packageFolders.PSObject.Properties.Name)[0]
    $runtimeVersion = $dependencies.dotnet.runtimeVersion
    $packs = @($assets.project.frameworks.PSObject.Properties.Value.downloadDependencies | Where-Object { $_.name -in @('Microsoft.NETCore.App.Runtime.win-x64', 'Microsoft.WindowsDesktop.App.Runtime.win-x64') })
    if ($packs.Count -ne 2 -or @($packs | Where-Object { $_.version -ne "[$runtimeVersion, $runtimeVersion]" }).Count -ne 0) { throw 'Resolved .NET runtime differs from the repository pin.' }
    $webviewVersion = ((Get-Content -LiteralPath 'desktop/windows/packages.lock.json' -Raw | ConvertFrom-Json).dependencies.PSObject.Properties.Value | ForEach-Object { $_.PSObject.Properties } | Where-Object { $_.Name -eq 'Microsoft.Web.WebView2' } | Select-Object -First 1).Value.resolved
    foreach ($package in @("microsoft.netcore.app.runtime.win-x64/$runtimeVersion", "microsoft.windowsdesktop.app.runtime.win-x64/$runtimeVersion", "microsoft.web.webview2/$webviewVersion")) {
        $source = Join-Path $nuget $package
        $target = Join-Path $resources "licenses/nuget/$package"
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        $notices = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -match '^(LICENSE|NOTICE|THIRD.?PARTY)' })
        if ($notices.Count -eq 0) { throw "Missing runtime license: $package" }
        $notices | Copy-Item -Destination $target
    }
    if ($IncludeWebViewRuntime) {
        $runtime = Get-VerifiedDependency $dependencies.webview2 $DependencyCache
        New-Item -ItemType Directory -Path (Join-Path $resources 'runtime') -Force | Out-Null
        Copy-Item -LiteralPath $runtime -Destination (Join-Path $resources 'runtime/MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
    }
    Copy-Item -LiteralPath 'LICENSE' -Destination (Join-Path $app 'LICENSE.txt')
    [IO.File]::WriteAllText((Join-Path $app 'README.txt'), @'
Cage lightweight remote client (unsigned development build)

Run Cage.exe. Requires Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime.
The .NET runtime ships with the app. Without WebView2, build with -IncludeWebViewRuntime to get a package that includes the verified installer; the build does not install it.
This computer provides only the window, the SSH connection, input, and file transfer; projects, the browser, terminals, and networking run in the cloud Cage.
The default connection config directory is .claude-cage/client under your user directory; an explicit CLAUDE_CAGE_CONFIG setting still applies.
This directory is a standalone build output. It does not install or replace the full Cage, or download full Cage updates automatically.
This build is not signed or released. The scope of Windows native run acceptance follows the project test report.
'@)
    if ($IsWindows) {
        Invoke-BuildTool (Join-Path $resources 'cage.exe') @('verify-web-assets')
        Assert-WindowsWorkbench $app
    }
    Compress-Archive -Path $app -DestinationPath (Join-Path $result 'Cage-Client-windows-amd64.zip') -CompressionLevel Optimal
    if (Test-Path -LiteralPath $destination) { throw 'Client output already exists; no files were replaced.' }
    Move-Item -LiteralPath $result -Destination $destination
    Write-Host "Built standalone client: $destination"
} finally {
    Pop-Location
    $env:GOOS = $savedGoOS; $env:GOARCH = $savedGoArch; $env:CGO_ENABLED = $savedCGO
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
