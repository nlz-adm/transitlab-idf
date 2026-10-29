Add-Type -AssemblyName System.Drawing
foreach ($name in @('rer-a.png','transilien-j.png','tram-t2.png','rer.png','mode-metro.png')) {
  $p = "assets/lines-mini/$name"
  if (-not (Test-Path $p)) { Write-Output "$name MISSING"; continue }
  $bmp = New-Object System.Drawing.Bitmap($p)
  $w = $bmp.Width; $h = $bmp.Height
  $samples = @(
    @([int]($w*0.10), [int]($h*0.10)),
    @([int]($w*0.90), [int]($h*0.10)),
    @([int]($w*0.50), [int]($h*0.15)),
    @([int]($w*0.50), [int]($h*0.55)),
    @([int]($w*0.10), [int]($h*0.90)),
    @([int]($w*0.50), [int]($h*0.92))
  )
  $parts = @()
  foreach ($s in $samples) {
    $c = $bmp.GetPixel($s[0], $s[1])
    $parts += "({0},{1})=({2},{3},{4},a{5})" -f $s[0], $s[1], $c.R, $c.G, $c.B, $c.A
  }
  Write-Output "$name ${w}x${h} " + ($parts -join ' | ')
  $bmp.Dispose()
}
