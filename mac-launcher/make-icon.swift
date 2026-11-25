import AppKit

// Downsample the enhanced transparent master into the macOS iconset sizes.
// This is independent of MoonIcon, which renders the live menu bar phase.
let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let source = URL(fileURLWithPath: CommandLine.arguments[2])
guard let image = NSImage(contentsOf: source), image.size.width >= 1024, image.size.height >= 1024 else {
    fatalError("Missing high-resolution app icon source: " + source.path)
}
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = NSSize(width: pixels, height: pixels)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        NSGraphicsContext.current?.imageInterpolation = .high
        image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels), from: .zero, operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 2 ? "@2x" : ""
        let file = destination.appendingPathComponent("icon_\(points)x\(points)\(suffix).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: file)
    }
}
