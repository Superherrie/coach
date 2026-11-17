# Draws the app icon (same design as public/icon.svg) as PNGs for iOS / Android home screens.
#   powershell -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\public'
foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $s = $size / 64.0
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#0f1f33'))   # full bleed: iOS rounds the corners itself
  $hill = New-Object System.Drawing.Drawing2D.GraphicsPath
  $hill.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (8*$s), (50*$s)), (New-Object System.Drawing.PointF (24*$s), (30*$s)),
    (New-Object System.Drawing.PointF (32*$s), (38*$s)), (New-Object System.Drawing.PointF (44*$s), (20*$s)),
    (New-Object System.Drawing.PointF (56*$s), (50*$s))))
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#1d3a5f'))), $hill)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e8642c')), (4*$s)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawBezier($pen, (14*$s), (50*$s), (24*$s), (44*$s), (30*$s), (40*$s), (34*$s), (34*$s))
  $g.DrawBezier($pen, (34*$s), (34*$s), (38*$s), (28*$s), (42*$s), (24*$s), (44*$s), (20*$s))
  $flag = New-Object System.Drawing.Drawing2D.GraphicsPath
  $flag.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF (44*$s), (8*$s)), (New-Object System.Drawing.PointF (53*$s), (8*$s)),
    (New-Object System.Drawing.PointF (50*$s), (11*$s)), (New-Object System.Drawing.PointF (53*$s), (14*$s)),
    (New-Object System.Drawing.PointF (44*$s), (14*$s))))
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#f4f5f2'))), $flag)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#f4f5f2'))), (44*$s), (8*$s), (1.6*$s), (12*$s))
  $name = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Write-Output 'icons written'
