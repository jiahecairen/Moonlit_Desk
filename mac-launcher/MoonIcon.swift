import AppKit

// Use the same Unicode moon phases as the website, rendered with macOS's
// color emoji font. Keep the image non-template so the system preserves it.
enum MoonIcon {
    static let phases = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"]

    static func image(_ lunar: LunarPhase) -> NSImage {
        let image = NSImage(size: NSSize(width: 22, height: 22), flipped: false) { _ in
            let glyph = NSAttributedString(string: phases[lunar.index], attributes: [
                .font: NSFont(name: "Apple Color Emoji", size: 18) ?? NSFont.systemFont(ofSize: 18)
            ])
            let size = glyph.size()
            NSGraphicsContext.saveGraphicsState()
            let transform = NSAffineTransform()
            transform.translateX(by: 11, yBy: 11)
            // Emoji show waxing light on the right and waning light on the left.
            // Rotate that standard view to the observer's local sky orientation.
            let standardAngle = lunar.phase < 0.5 ? 0.0 : Double.pi
            transform.rotate(byRadians: lunar.screenRotation - standardAngle)
            transform.concat()
            glyph.draw(at: NSPoint(x: -size.width / 2, y: -size.height / 2))
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
        image.isTemplate = false
        return image
    }
}
