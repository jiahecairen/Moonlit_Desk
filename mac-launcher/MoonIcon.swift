import AppKit

// A full-color, resolution-independent moon. Template images turn every opaque
// pixel into the menu bar's text color, which makes a full moon a black disc.
enum MoonIcon {
    static func image(_ lunar: LunarPhase) -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 20), flipped: false) { _ in
            let disc = NSBezierPath(ovalIn: NSRect(x: 1.4, y: 1.4, width: 17.2, height: 17.2))
            func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
                NSColor(srgbRed: r, green: g, blue: b, alpha: alpha)
            }
            NSGraphicsContext.saveGraphicsState()
            disc.addClip()
            // Earthshine keeps the unlit hemisphere recognizable even at new moon.
            NSGradient(starting: color(0.29, 0.33, 0.40), ending: color(0.12, 0.15, 0.21))!
                .draw(in: disc, angle: -55)
            let light = NSBezierPath()
            let angle = lunar.screenRotation
            func point(_ x: Double, _ y: Double) -> NSPoint {
                NSPoint(x: 10 + 8.6 * (x * cos(angle) - y * sin(angle)),
                        y: 10 + 8.6 * (x * sin(angle) + y * cos(angle)))
            }
            for i in 0...160 {
                let y = 1 - Double(i) / 80
                let x = sqrt(max(0, 1 - y * y))
                if i == 0 { light.move(to: point(x, y)) } else { light.line(to: point(x, y)) }
            }
            for i in 0...160 {
                let y = -1 + Double(i) / 80
                let x = (1 - 2 * lunar.fraction) * sqrt(max(0, 1 - y * y))
                light.line(to: point(x, y))
            }
            light.close()
            NSGradient(starting: color(1, 0.98, 0.87), ending: color(0.76, 0.76, 0.69))!
                .draw(in: light, angle: -55)
            // Stylized maria and crater rims, large enough to read at menu bar size.
            // The same landmarks continue faintly across the shadow hemisphere.
            let landmarks: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
                (4.0, 10.7, 4.4, 4.9), (7.0, 12.8, 4.0, 3.0),
                (9.0, 10.0, 3.8, 4.3), (12.1, 11.9, 2.4, 2.8),
                (5.6, 7.6, 3.4, 2.8), (11.9, 5.1, 2.6, 2.6),
                (7.8, 4.0, 1.5, 1.5), (14.5, 8.2, 1.3, 1.6)
            ]
            color(0.06, 0.08, 0.12, 0.18).setFill()
            for (x, y, w, h) in landmarks { NSBezierPath(ovalIn: NSRect(x: x, y: y, width: w, height: h)).fill() }
            NSGraphicsContext.saveGraphicsState()
            light.addClip()
            for (x, y, w, h) in landmarks {
                let crater = NSBezierPath(ovalIn: NSRect(x: x, y: y, width: w, height: h))
                color(0.38, 0.40, 0.36, 0.20).setFill(); crater.fill()
                color(1, 1, 0.91, 0.22).setStroke(); crater.lineWidth = 0.28; crater.stroke()
            }
            NSGraphicsContext.restoreGraphicsState()
            NSGraphicsContext.restoreGraphicsState()
            color(0.18, 0.20, 0.24, 0.60).setStroke(); disc.lineWidth = 0.55; disc.stroke()
            return true
        }
        image.isTemplate = false
        return image
    }
}
