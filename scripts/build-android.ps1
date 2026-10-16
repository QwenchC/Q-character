param([ValidateSet('Debug','Release')][string]$Configuration='Release')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path $PSScriptRoot -Parent
Push-Location $taskRoot
try {
    if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\javac.exe")) {
        $taskJdk='D:\Program Files\Android\Android Studio\jbr'
        if (Test-Path "$taskJdk\bin\javac.exe") { $env:JAVA_HOME=$taskJdk } else { throw 'Set JAVA_HOME to JDK 17 or newer.' }
    }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    if (-not (Test-Path "$taskRoot\android\local.properties")) {
        $taskSdk=$env:ANDROID_HOME.Replace('\','\\').Replace(':','\:')
        [IO.File]::WriteAllText("$taskRoot\android\local.properties","sdk.dir=$taskSdk`n")
    }
    if ($Configuration -eq 'Release' -and -not $env:QCHAR_ANDROID_KEYSTORE) {
        $taskSigning=Join-Path $env:USERPROFILE '.q-character\android-signing.json'
        if (Test-Path -LiteralPath $taskSigning) {
            $taskKeys=Get-Content -LiteralPath $taskSigning -Raw | ConvertFrom-Json
            $env:QCHAR_ANDROID_KEYSTORE=$taskKeys.keystore
            $env:QCHAR_ANDROID_STORE_PASSWORD=$taskKeys.password
            $env:QCHAR_ANDROID_KEY_PASSWORD=$taskKeys.password
        } else { throw 'Configure QCHAR_ANDROID_KEYSTORE and signing passwords first. See docs/ANDROID.md. Use -Configuration Debug for development.' }
    }
    & npm.cmd run android:prepare
    if ($LASTEXITCODE -ne 0) { throw 'Android web build failed.' }
    & "$taskRoot\android\gradlew.bat" -p "$taskRoot\android" "assemble$Configuration" --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android package build failed.' }
    $taskVariant=$Configuration.ToLowerInvariant()
    $taskApk="$taskRoot\android\app\build\outputs\apk\$taskVariant\app-$taskVariant.apk"
    if (-not (Test-Path -LiteralPath $taskApk)) { throw 'Signed APK was not produced.' }
    $taskVersion=[regex]::Match((Get-Content "$taskRoot\android\app\build.gradle" -Raw),"versionName '([^']+)'").Groups[1].Value
    New-Item "$taskRoot\release" -ItemType Directory -Force | Out-Null
    $taskName="Q-Character-Android-$taskVersion$(if($Configuration -eq 'Debug'){'-debug'}).apk"
    Copy-Item -LiteralPath $taskApk -Destination "$taskRoot\release\$taskName" -Force
    $taskAlgorithm=[Security.Cryptography.SHA256]::Create()
    $taskStream=[IO.File]::OpenRead("$taskRoot\release\$taskName")
    try { $taskHash=[BitConverter]::ToString($taskAlgorithm.ComputeHash($taskStream)).Replace('-','').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskAlgorithm.Dispose() }
    [IO.File]::WriteAllText("$taskRoot\release\$taskName.sha256","$taskHash  $taskName`n")
    Write-Host "Created release/$taskName"
    Write-Host "SHA256: $taskHash"
} finally { Pop-Location }
