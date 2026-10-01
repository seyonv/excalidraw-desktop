import CoreGraphics
let owner = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "sketchshelf"
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var best: (Int, Double)? = nil
for w in list {
  guard (w[kCGWindowOwnerName as String] as? String)?.lowercased() == owner.lowercased(),
        (w[kCGWindowLayer as String] as? Int) == 0,
        let name = w[kCGWindowName as String] as? String, !name.isEmpty,
        let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
  let area = (b["Width"] as? Double ?? 0) * (b["Height"] as? Double ?? 0)
  if best == nil || area > best!.1 { best = (w[kCGWindowNumber as String] as! Int, area) }
}
if let b = best { print(b.0) }
