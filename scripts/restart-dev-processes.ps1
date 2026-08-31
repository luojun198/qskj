param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,

    [Parameter(Mandatory = $true)]
    [string]$NpmCommand,

    [Parameter(Mandatory = $true)]
    [string]$StateFile,

    [string]$PortList = '3105 5275',

    [Parameter(Mandatory = $true)]
    [string]$DatabasePath
)

$ErrorActionPreference = 'Stop'
$projectPath = [System.IO.Path]::GetFullPath($ProjectRoot)
$databasePath = [System.IO.Path]::GetFullPath($DatabasePath)
if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
    throw "Development database was not found: $databasePath"
}
$ports = @($PortList -split '[,;\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })

if (-not ('CwProcessTreeSnapshot' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CwProcessTreeSnapshot
{
    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static Dictionary<int, int> GetParents()
    {
        var result = new Dictionary<int, int>();
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == InvalidHandleValue)
            return result;

        try
        {
            var entry = new PROCESSENTRY32();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32First(snapshot, ref entry))
                return result;

            do
            {
                result[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            }
            while (Process32Next(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }
        return result;
    }
}
'@
}

$script:parentMap = [CwProcessTreeSnapshot]::GetParents()

function Get-ListeningProcessIds {
    param([int[]]$TargetPorts)

    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    $portSet = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($port in $TargetPorts) {
        [void]$portSet.Add($port)
    }

    $netstatPath = Join-Path $env:SystemRoot 'System32\netstat.exe'
    foreach ($line in @(& $netstatPath -aon -p TCP)) {
        $parts = @($line -split '\s+' | Where-Object { $_ })
        if ($parts.Count -lt 5 -or $parts[0] -ne 'TCP' -or $parts[3] -ne 'LISTENING') {
            continue
        }
        if ($parts[1] -match ':(\d+)$') {
            $localPort = [int]$Matches[1]
            if ($portSet.Contains($localPort)) {
                [void]$ids.Add([int]$parts[4])
            }
        }
    }
    return @($ids)
}

function Stop-ProcessIds {
    param([int[]]$ProcessIds)

    foreach ($processId in @($ProcessIds | Sort-Object -Unique)) {
        if ($processId -le 0 -or $processId -eq $PID) {
            continue
        }
        $rootId = $processId
        $cursor = $processId
        $visited = New-Object 'System.Collections.Generic.HashSet[int]'
        while ($script:parentMap.ContainsKey($cursor) -and $visited.Add($cursor)) {
            $parentId = [int]$script:parentMap[$cursor]
            $parent = Get-Process -Id $parentId -ErrorAction SilentlyContinue
            if (-not $parent -or $parent.ProcessName -notin @('cmd', 'node', 'conhost')) {
                break
            }
            $rootId = $parentId
            $cursor = $parentId
        }
        Stop-ProcessTree -RootProcessId $rootId
    }
}

function Stop-ProcessTree {
    param([int]$RootProcessId)

    if ($RootProcessId -le 0 -or $RootProcessId -eq $PID) {
        return
    }

    $rootProcess = Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue
    if (-not $rootProcess) {
        return
    }

    Write-Host ("      Stopping process tree PID {0} ({1})" -f $RootProcessId, $rootProcess.ProcessName)
    $treeIds = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$treeIds.Add($RootProcessId)
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($entry in $script:parentMap.GetEnumerator()) {
            if ($treeIds.Contains([int]$entry.Value) -and -not $treeIds.Contains([int]$entry.Key)) {
                [void]$treeIds.Add([int]$entry.Key)
                $changed = $true
            }
        }
    }

    $depths = @{}
    foreach ($processId in @($treeIds)) {
        $depth = 0
        $cursor = $processId
        $visited = New-Object 'System.Collections.Generic.HashSet[int]'
        while ($script:parentMap.ContainsKey($cursor) -and $visited.Add($cursor)) {
            $parentId = [int]$script:parentMap[$cursor]
            if (-not $treeIds.Contains($parentId)) {
                break
            }
            $depth++
            $cursor = $parentId
        }
        $depths[$processId] = $depth
    }

    foreach ($processId in @($treeIds | Sort-Object { $depths[$_] } -Descending)) {
        if ($processId -ne $PID) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-RecordedProcess {
    param($Record)

    $process = Get-Process -Id ([int]$Record.id) -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -ne 'cmd') {
        return $false
    }
    try {
        return $process.StartTime.ToUniversalTime().ToString('o') -eq [string]$Record.startedAtUtc
    } catch {
        return $false
    }
}

# First stop the exact cmd roots created by the previous shortcut launch.
if (Test-Path -LiteralPath $StateFile) {
    try {
        $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
        foreach ($record in @($state.processes)) {
            if (Test-RecordedProcess -Record $record) {
                Stop-ProcessTree -RootProcessId ([int]$record.id)
            }
        }
    } catch {
        Write-Host ("      Ignoring invalid process state: {0}" -f $_.Exception.Message)
    }
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
}

# Stop anything currently holding a project port, including manually started services.
$script:parentMap = [CwProcessTreeSnapshot]::GetParents()
Stop-ProcessIds -ProcessIds @(Get-ListeningProcessIds -TargetPorts $ports)
foreach ($attempt in 1..2) {
    Start-Sleep -Milliseconds 500
    $script:parentMap = [CwProcessTreeSnapshot]::GetParents()
    Stop-ProcessIds -ProcessIds @(Get-ListeningProcessIds -TargetPorts $ports)
}

$started = @()
try {
    # 在 cmd 启动链内设置，确保 npm 及其 Node 子进程均使用主开发库。
    $env:DB_PATH = $databasePath
    $env:DB_PATH = $databasePath
    $backendArguments = '/k ""{0}" run dev:server"' -f $NpmCommand
    $frontendArguments = '/k ""{0}" run dev:client"' -f $NpmCommand

    $backend = Start-Process -FilePath $env:ComSpec -ArgumentList $backendArguments -WorkingDirectory $projectPath -WindowStyle Normal -PassThru
    $started += $backend
    $frontend = Start-Process -FilePath $env:ComSpec -ArgumentList $frontendArguments -WorkingDirectory $projectPath -WindowStyle Normal -PassThru
    $started += $frontend

    Start-Sleep -Milliseconds 300
    $records = foreach ($process in $started) {
        $current = Get-Process -Id $process.Id -ErrorAction Stop
        [pscustomobject]@{
            id           = $current.Id
            role         = if ($current.Id -eq $backend.Id) { 'backend' } else { 'frontend' }
            startedAtUtc = $current.StartTime.ToUniversalTime().ToString('o')
        }
    }
    $state = [pscustomobject]@{
        projectRoot = $projectPath
        processes   = @($records)
    }
    $state | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $StateFile -Encoding UTF8
    Write-Host ("      Started backend root PID {0}" -f $backend.Id)
    Write-Host ("      Started frontend root PID {0}" -f $frontend.Id)
} catch {
    foreach ($process in $started) {
        $script:parentMap = [CwProcessTreeSnapshot]::GetParents()
        Stop-ProcessTree -RootProcessId $process.Id
    }
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
    Write-Error $_
    exit 1
}

exit 0
