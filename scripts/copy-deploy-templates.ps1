param(
  [Parameter(Mandatory = $true)]
  [string]$Root,

  [Parameter(Mandatory = $true)]
  [string]$Deploy
)

$ErrorActionPreference = 'Stop'

function Join-UnicodeName {
  param([int[]]$CodePoints)
  return -join ($CodePoints | ForEach-Object { [char]$_ })
}

function Copy-TemplateDirectory {
  param(
    [string]$Name,
    [string]$Label
  )

  $source = Join-Path $Root $Name
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    return
  }

  $deployRoot = if ([System.IO.Path]::IsPathRooted($Deploy)) {
    $Deploy
  } else {
    Join-Path $Root $Deploy
  }

  $target = Join-Path $deployRoot $Name
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }

  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
  Write-Host "      $Label copied"
}

$standardTemplateName = Join-UnicodeName @(0x6807, 0x51C6, 0x6A21, 0x7248)

Copy-TemplateDirectory -Name $standardTemplateName -Label 'Standard templates'
