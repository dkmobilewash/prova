// scanTool — renders a plan page to an 8-bit grey PGM (a stand-in for a scan)
// and reads text off a PGM with Apple's Vision OCR. Research tooling for the
// scanned-plans lane; the TS side (`lib/takeoff/raster/`) does everything else.
//
//   swiftc -O scanTool.swift -o scanTool
//   scanTool render <pdf> <page1based> <dpi> <out.pgm|out.png>
//   scanTool ocr <in.pgm> <out.json>      → [{ str, x, y, width, height }] in PIXELS, y down from the top
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Vision

let a = CommandLine.arguments
func die(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }
if a.count < 2 { die("usage: scanTool render <pdf> <page> <dpi> <out.pgm> | scanTool ocr <in.pgm> <out.json>") }

func writePGM(_ ctx: CGContext, _ w: Int, _ h: Int, _ path: String) {
  var out = Data("P5\n\(w) \(h)\n255\n".utf8)
  let bpr = ctx.bytesPerRow
  let base = ctx.data!.assumingMemoryBound(to: UInt8.self)
  for y in 0..<h { out.append(base + y * bpr, count: w) }
  try! out.write(to: URL(fileURLWithPath: path))
}

func readPGM(_ path: String) -> (Int, Int, Data) {
  let d = try! Data(contentsOf: URL(fileURLWithPath: path))
  // Header: P5\n<w> <h>\n255\n
  var fields: [String] = []; var i = 0; var cur = ""
  while fields.count < 4 && i < d.count {
    let c = Character(UnicodeScalar(d[i]))
    if c == " " || c == "\n" || c == "\t" { if !cur.isEmpty { fields.append(cur); cur = "" } } else { cur.append(c) }
    i += 1
  }
  let w = Int(fields[1])!, h = Int(fields[2])!
  return (w, h, d.subdata(in: i..<(i + w * h)))
}

switch a[1] {
case "render":
  let doc = PDFDocument(url: URL(fileURLWithPath: a[2]))!
  let page = doc.page(at: Int(a[3])! - 1)!
  let dpi = Double(a[4])!
  let b = page.bounds(for: .mediaBox)
  let rot = page.rotation
  let wPt = (rot % 180 == 0) ? b.width : b.height, hPt = (rot % 180 == 0) ? b.height : b.width
  let s = dpi / 72
  let w = Int((wPt * s).rounded()), h = Int((hPt * s).rounded())
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
  ctx.setFillColor(gray: 1, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: s, y: s)
  // PDFKit applies /Rotate itself (see roomCrops.swift); no extra transform.
  page.draw(with: .mediaBox, to: ctx)
  if a[5].hasSuffix(".png") {
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[5]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
  } else {
    writePGM(ctx, w, h, a[5])
  }
  print("rendered \(w)x\(h) px at \(Int(dpi)) dpi (\(Int(wPt))x\(Int(hPt)) pt, rotate \(rot))")

case "ocr":
  // scanTool ocr <in.pgm> <out.json> [tilePx]
  //
  // TILED, because Vision works at a capped resolution: on a whole 300 dpi
  // sheet it reads the room names and misses the 4 pt scale caption under a
  // view title. Tiles of ~2000 px with an overlap keep small text legible; a
  // reading seen in two tiles' overlap is kept once.
  let (w, h, px) = readPGM(a[2])
  let tile = a.count > 4 ? Int(a[4])! : 2000
  let overlap = 160
  let provider = CGDataProvider(data: px as CFData)!
  let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  let t0 = Date()
  var items: [[String: Any]] = []
  var seen: [(Double, Double, String)] = []
  var y0 = 0
  while y0 < h {
    var x0 = 0
    let th = min(tile, h - y0)
    while x0 < w {
      let tw = min(tile, w - x0)
      let crop = img.cropping(to: CGRect(x: x0, y: y0, width: tw, height: th))!
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate
      req.usesLanguageCorrection = false
      try! VNImageRequestHandler(cgImage: crop, options: [:]).perform([req])
      for obs in req.results ?? [] {
        guard let top = obs.topCandidates(1).first else { continue }
        let bb = obs.boundingBox // normalised within the tile, origin bottom-left
        let x = Double(x0) + bb.minX * Double(tw), y = Double(y0) + (1 - bb.minY) * Double(th)
        if seen.contains(where: { abs($0.0 - x) < 6 && abs($0.1 - y) < 6 && $0.2 == top.string }) { continue }
        seen.append((x, y, top.string))
        items.append(["str": top.string, "confidence": Double(top.confidence),
                      "x": x, "y": y, "width": bb.width * Double(tw), "height": bb.height * Double(th)])
      }
      if x0 + tw >= w { break }
      x0 += tile - overlap
    }
    if y0 + th >= h { break }
    y0 += tile - overlap
  }
  let json = try! JSONSerialization.data(withJSONObject: ["widthPx": w, "heightPx": h, "ms": Int(Date().timeIntervalSince(t0) * 1000), "items": items])
  try! json.write(to: URL(fileURLWithPath: a[3]))
  print("ocr \(items.count) items in \(Int(Date().timeIntervalSince(t0) * 1000)) ms")
case "overlay":
  // scanTool overlay <in.pgm> <marks.json> <out.png> [pxWide]
  // marks.json: { "layers": [{ "color": [r,g,b], "width": w, "segments": [[x1,y1,x2,y2], …] }] } in PIXELS, y down.
  let (w, h, px) = readPGM(a[2])
  let marks = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[3]))) as! [String: Any]
  let outW = a.count > 5 ? Int(a[5])! : 2400
  let s = Double(outW) / Double(w)
  let ctx = CGContext(data: nil, width: outW, height: Int(Double(h) * s), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  let provider = CGDataProvider(data: px as CFData)!
  let img = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: Double(outW), height: Double(h) * s))
  ctx.scaleBy(x: s, y: s)
  for layer in marks["layers"] as! [[String: Any]] {
    let c = layer["color"] as! [Double]
    ctx.setStrokeColor(CGColor(red: c[0], green: c[1], blue: c[2], alpha: 0.85))
    ctx.setLineWidth((layer["width"] as? Double ?? 2) / s)
    for seg in layer["segments"] as! [[Double]] {
      ctx.move(to: CGPoint(x: seg[0], y: Double(h) - seg[1])); ctx.addLine(to: CGPoint(x: seg[2], y: Double(h) - seg[3])); ctx.strokePath()
    }
  }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[4]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
  print("overlay written")
default:
  die("unknown command \(a[1])")
}
