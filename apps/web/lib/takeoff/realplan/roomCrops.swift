// roomCrops <dump.json> <outdir> [crop spec json]
// Renders the page with: walls (red), room polygons (green fill, tagged; orange, untagged),
// tags (blue dot = placed, magenta = merged, black X = open). Then one crop PNG per entry in crops.
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let j = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[1]))) as! [String: Any]
let outDir = a[2]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
let doc = PDFDocument(url: URL(fileURLWithPath: j["pdf"] as! String))!
let page = doc.page(at: (j["page"] as! Int) - 1)!
let W = j["widthPt"] as! Double, H = j["heightPt"] as! Double
let walls = j["walls"] as! [[String: Any]]
let rooms = j["rooms"] as! [[String: Any]]
let open = j["unplacedTags"] as! [[String: Any]]
let merged = j["mergedTags"] as! [[String: Any]]
let fpu = j["feetPerUnit"] as! Double
func d(_ v: Any?) -> Double { if let x = v as? Double { return x }; if let i = v as? Int { return Double(i) }; return 0 }
// crops: [{name, x, y, halfFeet}] in page-width units; default = every open/merged tag
var crops: [[String: Any]] = []
if a.count > 3 { crops = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[3]))) as! [[String: Any]] }
else {
  for t in open { crops.append(["name": "open-\((t["number"] as? String) ?? (t["name"] as! String))", "x": t["x"]!, "y": t["y"]!, "halfFeet": 30.0]) }
  for t in merged { crops.append(["name": "merged-\((t["number"] as? String) ?? (t["name"] as! String))", "x": t["x"]!, "y": t["y"]!, "halfFeet": 30.0]) }
}
func render(x0: Double, y0: Double, x1: Double, y1: Double, px: Double, path: String, lineScale: Double) {
  // x0..x1, y0..y1 in page-width units, y from top
  let cw = (x1 - x0) * W, ch = (y1 - y0) * W
  let s = px / max(cw, ch)
  let ctx = CGContext(data: nil, width: Int(cw * s), height: Int(ch * s), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: cw * s, height: ch * s))
  ctx.scaleBy(x: s, y: s)
  // PDF user space is y-up; our units are y-down from the top. Page point (px, py_down) → (px, H - py_down).
  ctx.translateBy(x: -x0 * W, y: -(H - y1 * W))
  ctx.saveGState(); page.draw(with: .mediaBox, to: ctx); ctx.restoreGState()
  func P(_ ux: Double, _ uy: Double) -> CGPoint { CGPoint(x: ux * W, y: H - uy * W) }
  // rooms
  for r in rooms {
    let xs = (r["xs"] as! [Any]).map(d), ys = (r["ys"] as! [Any]).map(d)
    let tagged = r["tag"] != nil && !(r["tag"] is NSNull)
    ctx.beginPath(); ctx.move(to: P(xs[0], ys[0])); for i in 1..<xs.count { ctx.addLine(to: P(xs[i], ys[i])) }; ctx.closePath()
    ctx.setFillColor(tagged ? CGColor(red: 0, green: 0.7, blue: 0.2, alpha: 0.18) : CGColor(red: 1, green: 0.6, blue: 0, alpha: 0.18))
    ctx.setStrokeColor(tagged ? CGColor(red: 0, green: 0.5, blue: 0.1, alpha: 0.9) : CGColor(red: 0.9, green: 0.5, blue: 0, alpha: 0.9))
    ctx.setLineWidth(1.2 * lineScale); ctx.drawPath(using: .fillStroke)
    if tagged, let t = r["tag"] as? [String: Any] {
      let sf = d(r["squareFeet"])
      let label = "\(Int(sf.rounded())) sf" as NSString
      let p = P(d(t["x"]), d(t["y"]))
      ctx.saveGState(); ctx.translateBy(x: p.x + 4 * lineScale, y: p.y - 10 * lineScale); ctx.scaleBy(x: 1, y: 1)
      let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 5 * lineScale), .foregroundColor: NSColor(red: 0, green: 0.4, blue: 0.1, alpha: 1)]
      let line = CTLineCreateWithAttributedString(NSAttributedString(string: label as String, attributes: attrs))
      ctx.textPosition = CGPoint(x: 0, y: 0); CTLineDraw(line, ctx); ctx.restoreGState()
    }
  }
  // walls
  ctx.setStrokeColor(CGColor(red: 0.9, green: 0, blue: 0, alpha: 0.75))
  for w in walls {
    let t = (d(w["thicknessFeet"]) > 0 ? d(w["thicknessFeet"]) : 0.4) / fpu * W
    ctx.setLineWidth(max(t, 0.8 * lineScale))
    ctx.move(to: P(d(w["x1"]), d(w["y1"]))); ctx.addLine(to: P(d(w["x2"]), d(w["y2"]))); ctx.strokePath()
  }
  // tags
  func dot(_ t: [String: Any], _ c: CGColor, cross: Bool) {
    let p = P(d(t["x"]), d(t["y"])); let r = 3.0 * lineScale
    ctx.setStrokeColor(c); ctx.setLineWidth(1.5 * lineScale)
    if cross { ctx.move(to: CGPoint(x: p.x - r, y: p.y - r)); ctx.addLine(to: CGPoint(x: p.x + r, y: p.y + r)); ctx.move(to: CGPoint(x: p.x - r, y: p.y + r)); ctx.addLine(to: CGPoint(x: p.x + r, y: p.y - r)); ctx.strokePath() }
    else { ctx.strokeEllipse(in: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)) }
  }
  for r in rooms { if let t = r["tag"] as? [String: Any] { dot(t, CGColor(red: 0, green: 0.2, blue: 1, alpha: 1), cross: false) } }
  for t in merged { dot(t, CGColor(red: 0.9, green: 0, blue: 0.9, alpha: 1), cross: false) }
  for t in open { dot(t, CGColor(red: 0, green: 0, blue: 0, alpha: 1), cross: true) }
  let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
}
import AppKit
let base = (j["set"] as! String).replacingOccurrences(of: ".pdf", with: "") + "__" + ((j["sheet"] as? String) ?? "p\(j["page"]!)")
render(x0: 0, y0: 0, x1: 1, y1: H / W, px: 2400, path: "\(outDir)/\(base)__page.png", lineScale: 1.0)
for c in crops {
  let half = d(c["halfFeet"]) / fpu
  let cx = d(c["x"]), cy = d(c["y"])
  let name = (c["name"] as! String).replacingOccurrences(of: "/", with: "-")
  render(x0: max(0, cx - half), y0: max(0, cy - half), x1: min(1, cx + half), y1: min(H / W, cy + half), px: 1000, path: "\(outDir)/\(base)__\(name).png", lineScale: 0.5)
}
print("wrote \(crops.count + 1) images to \(outDir)")
