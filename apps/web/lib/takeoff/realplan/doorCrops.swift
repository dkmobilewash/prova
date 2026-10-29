// doorCrops <dump.json> <outdir> [crop spec json]
// Renders the page with walls (red), doors (blue leaf hinge→strike with width label;
// magenta when on no found wall), windows (green bar, width label). Then tiles or crops.
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
let walls = j["walls"] as! [[String: Any]]
let doors = j["doors"] as! [[String: Any]]
let windows = j["windows"] as! [[String: Any]]
let fpu = j["feetPerUnit"] as! Double
func d(_ v: Any?) -> Double { if let x = v as? Double { return x }; if let i = v as? Int { return Double(i) }; return 0 }
var crops: [[String: Any]] = []
if a.count > 3 { crops = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[3]))) as! [[String: Any]] }
func render(x0: Double, y0: Double, x1: Double, y1: Double, px: Double, path: String, lineScale: Double) {
  let cw = (x1 - x0) * W, ch = (y1 - y0) * W
  let s = px / max(cw, ch)
  let ctx = CGContext(data: nil, width: Int(cw * s), height: Int(ch * s), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: cw * s, height: ch * s))
  ctx.scaleBy(x: s, y: s)
  ctx.translateBy(x: -x0 * W, y: -(H - y1 * W))
  ctx.saveGState(); page.draw(with: .mediaBox, to: ctx); ctx.restoreGState()
  func P(_ ux: Double, _ uy: Double) -> CGPoint { CGPoint(x: ux * W, y: H - uy * W) }
  func label(_ text: String, at p: CGPoint, color: NSColor) {
    ctx.saveGState(); ctx.translateBy(x: p.x + 2 * lineScale, y: p.y + 2 * lineScale)
    let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 5 * lineScale), .foregroundColor: color]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    ctx.textPosition = CGPoint(x: 0, y: 0); CTLineDraw(line, ctx); ctx.restoreGState()
  }
  ctx.setStrokeColor(CGColor(red: 0.9, green: 0, blue: 0, alpha: 0.3))
  for w in walls {
    let t = (d(w["thicknessFeet"]) > 0 ? d(w["thicknessFeet"]) : 0.4) / fpu * W
    ctx.setLineWidth(max(t, 0.8 * lineScale))
    ctx.move(to: P(d(w["x1"]), d(w["y1"]))); ctx.addLine(to: P(d(w["x2"]), d(w["y2"]))); ctx.strokePath()
  }
  for (i, dr) in doors.enumerated() {
    let h = dr["hinge"] as! [String: Any], st = dr["strike"] as! [String: Any]
    let hp = P(d(h["x"]), d(h["y"])), sp = P(d(st["x"]), d(st["y"]))
    let onWall = !(dr["wall"] is NSNull)
    let col = onWall ? CGColor(red: 0, green: 0.3, blue: 1, alpha: 0.9) : CGColor(red: 0.8, green: 0, blue: 0.8, alpha: 0.9)
    ctx.setStrokeColor(col); ctx.setLineWidth(1.5 * lineScale)
    ctx.move(to: hp); ctx.addLine(to: sp); ctx.strokePath()
    let r = 2.5 * lineScale
    ctx.setFillColor(col); ctx.fillEllipse(in: CGRect(x: hp.x - r, y: hp.y - r, width: 2 * r, height: 2 * r))
    label("D\(i) \(String(format: "%.1f", d(dr["widthFeet"])))'", at: CGPoint(x: (hp.x + sp.x) / 2, y: (hp.y + sp.y) / 2), color: NSColor(red: 0, green: 0.2, blue: 0.8, alpha: 1))
  }
  for (i, wn) in windows.enumerated() {
    let p1 = P(d(wn["x1"]), d(wn["y1"])), p2 = P(d(wn["x2"]), d(wn["y2"]))
    ctx.setStrokeColor(CGColor(red: 0, green: 0.6, blue: 0.1, alpha: 0.8)); ctx.setLineWidth(3 * lineScale)
    ctx.move(to: p1); ctx.addLine(to: p2); ctx.strokePath()
    label("W\(i) \(String(format: "%.1f", d(wn["widthFeet"])))'", at: CGPoint(x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2), color: NSColor(red: 0, green: 0.4, blue: 0.1, alpha: 1))
  }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
let base = (j["pdf"] as! String).split(separator: "/").last!.replacingOccurrences(of: ".pdf", with: "") + "__p\(j["page"]!)"
render(x0: 0, y0: 0, x1: 1, y1: H / W, px: 3000, path: "\(outDir)/\(base)__page.png", lineScale: 1.0)
if crops.isEmpty {
  let cols = Int(d(j["cols"] ?? 3)), rows = Int(d(j["rows"] ?? 2))
  let ax0 = d(j["areaX0"] ?? 0), ay0 = d(j["areaY0"] ?? 0), ax1 = d(j["areaX1"] ?? 1), ay1 = d(j["areaY1"] ?? (H / W))
  for r in 0..<rows { for c in 0..<cols {
    let x0 = ax0 + (ax1 - ax0) * Double(c) / Double(cols), x1 = ax0 + (ax1 - ax0) * Double(c + 1) / Double(cols)
    let y0 = ay0 + (ay1 - ay0) * Double(r) / Double(rows), y1 = ay0 + (ay1 - ay0) * Double(r + 1) / Double(rows)
    render(x0: x0, y0: y0, x1: x1, y1: y1, px: 1800, path: "\(outDir)/\(base)__tile-r\(r)c\(c).png", lineScale: 0.45)
  } }
} else {
  for c in crops {
    let half = d(c["halfFeet"]) / fpu
    let cx = d(c["x"]), cy = d(c["y"])
    let name = (c["name"] as! String).replacingOccurrences(of: "/", with: "-")
    render(x0: max(0, cx - half), y0: max(0, cy - half), x1: min(1, cx + half), y1: min(H / W, cy + half), px: 1000, path: "\(outDir)/\(base)__\(name).png", lineScale: 0.5)
  }
}
print("wrote images to \(outDir)")
