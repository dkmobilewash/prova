// symbolCrops <dump.json> <outdir>
// Renders the page with the template box (blue) and every match (green box; red when the
// key says it is false, amber for key points no match covers), then tiles over the area.
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import AppKit
let a = CommandLine.arguments
let j = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[1]))) as! [String: Any]
let outDir = a[2]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let doc = PDFDocument(url: URL(fileURLWithPath: j["pdf"] as! String))!
let page = doc.page(at: (j["page"] as! Int) - 1)!
let W = j["widthPt"] as! Double, H = j["heightPt"] as! Double
func d(_ v: Any?) -> Double { if let x = v as? Double { return x }; if let i = v as? Int { return Double(i) }; return 0 }
let template = j["template"] as! [String: Any]
let matches = j["matches"] as! [[String: Any]]
let keyPts = (j["keyPoints"] as? [[String: Any]]) ?? []
func render(x0: Double, y0: Double, x1: Double, y1: Double, px: Double, path: String, lineScale: Double) {
  let cw = (x1 - x0) * W, ch = (y1 - y0) * W
  let s = px / max(cw, ch)
  let ctx = CGContext(data: nil, width: Int(cw * s), height: Int(ch * s), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: cw * s, height: ch * s))
  ctx.scaleBy(x: s, y: s); ctx.translateBy(x: -x0 * W, y: -(H - y1 * W))
  ctx.saveGState(); page.draw(with: .mediaBox, to: ctx); ctx.restoreGState()
  func R(_ b: [String: Any]) -> CGRect {
    let bx1 = min(d(b["x1"]), d(b["x2"])), bx2 = max(d(b["x1"]), d(b["x2"])), by1 = min(d(b["y1"]), d(b["y2"])), by2 = max(d(b["y1"]), d(b["y2"]))
    return CGRect(x: bx1 * W, y: H - by2 * W, width: (bx2 - bx1) * W, height: (by2 - by1) * W).insetBy(dx: -2 * lineScale, dy: -2 * lineScale)
  }
  ctx.setLineWidth(1.5 * lineScale)
  for (i, m) in matches.enumerated() {
    let bad = (m["falsePositive"] as? Bool) ?? false
    ctx.setStrokeColor(bad ? CGColor(red: 0.9, green: 0, blue: 0, alpha: 0.9) : CGColor(red: 0, green: 0.6, blue: 0.1, alpha: 0.9))
    let r = R(m["box"] as! [String: Any]); ctx.stroke(r)
    ctx.saveGState(); ctx.translateBy(x: r.minX, y: r.maxY + 1 * lineScale)
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 4 * lineScale), .foregroundColor: bad ? NSColor.red : NSColor(red: 0, green: 0.4, blue: 0.1, alpha: 1)]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "\(i) d\(String(format: "%.2f", d(m["distance"])))", attributes: attrs))
    ctx.textPosition = .zero; CTLineDraw(line, ctx); ctx.restoreGState()
  }
  ctx.setStrokeColor(CGColor(red: 0, green: 0.3, blue: 1, alpha: 1)); ctx.setLineWidth(2 * lineScale); ctx.stroke(R(template))
  for k in keyPts where ((k["missed"] as? Bool) ?? false) {
    let p = CGPoint(x: d(k["x"]) * W, y: H - d(k["y"]) * W); let r = 5 * lineScale
    ctx.setStrokeColor(CGColor(red: 1, green: 0.6, blue: 0, alpha: 1)); ctx.strokeEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
  }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
let base = (j["name"] as? String) ?? "symbols"
render(x0: 0, y0: 0, x1: 1, y1: H / W, px: 3000, path: "\(outDir)/\(base)__page.png", lineScale: 1.0)
let cols = Int(d(j["cols"] ?? 3)), rows = Int(d(j["rows"] ?? 2))
let ax0 = d(j["areaX0"] ?? 0), ay0 = d(j["areaY0"] ?? 0), ax1 = d(j["areaX1"] ?? 1), ay1 = d(j["areaY1"] ?? (H / W))
for r in 0..<rows { for c in 0..<cols {
  let x0 = ax0 + (ax1 - ax0) * Double(c) / Double(cols), x1 = ax0 + (ax1 - ax0) * Double(c + 1) / Double(cols)
  let y0 = ay0 + (ay1 - ay0) * Double(r) / Double(rows), y1 = ay0 + (ay1 - ay0) * Double(r + 1) / Double(rows)
  render(x0: x0, y0: y0, x1: x1, y1: y1, px: 1800, path: "\(outDir)/\(base)__tile-r\(r)c\(c).png", lineScale: 0.45)
} }
print("wrote images to \(outDir)")
