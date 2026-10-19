$project = Split-Path -Parent $PSScriptRoot
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compilador C# do Windows não encontrado.' }
& $compiler /nologo /target:winexe "/out:$project\Lembre.exe" /reference:System.Windows.Forms.dll "$PSScriptRoot\Program.cs"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar Lembre.exe.' }
