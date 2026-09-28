param([string]$NgrokPath = '')
$ErrorActionPreference = 'Stop'
$secureToken = $null
$tokenPointer = [IntPtr]::Zero
$plainToken = $null
try {
    if (-not $NgrokPath) {
        $installed = Get-Command ngrok.exe -ErrorAction SilentlyContinue
        if ($installed) { $NgrokPath = $installed.Source }
        else { $NgrokPath = Join-Path $PSScriptRoot '..\.local\ngrok\ngrok.exe' }
    }
    if (-not (Test-Path -LiteralPath $NgrokPath)) { throw 'Install ngrok first' }
    Write-Host 'Paste your ngrok authtoken locally, then press Enter. Input is hidden.'
    Write-Host 'Do not enter a Higgsfield credential or paste either token into chat.'
    $secureToken = Read-Host 'ngrok authtoken' -AsSecureString
    if ($secureToken.Length -eq 0) { throw 'Empty input' }
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $discardedOutput = & $NgrokPath config add-authtoken $plainToken --log=false 2>&1
    $commandExitCode = $LASTEXITCODE
    $discardedOutput = $null
    if ($commandExitCode -ne 0) { throw 'Configuration command failed' }
    Write-Host 'ngrok authentication saved in its local user configuration.'
} catch {
    Write-Host 'ngrok configuration failed. Verify ngrok is installed and retry. Sensitive diagnostics suppressed.'
    exit 1
} finally {
    $plainToken = $null
    if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    if ($null -ne $secureToken) { $secureToken.Dispose() }
}
