// Generates the OCR fixture photos in tests/fixtures/ocr (macOS): swift scripts/make-ocr-fixtures.swift
// The text is invented for testing; no personal content.
import AppKit
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "tests/fixtures/ocr")
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func render(width: Int, height: Int, background: NSColor, draw: (CGContext) -> Void) -> CGImage {
  let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.setFillColor(background.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
  draw(context)
  NSGraphicsContext.restoreGraphicsState()
  return context.makeImage()!
}

func text(_ string: String, in rect: CGRect, size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) {
  let style = NSMutableParagraphStyle(); style.lineSpacing = size * 0.35
  NSAttributedString(string: string, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: style]).draw(in: rect)
}

func save(_ image: CGImage, _ name: String, _ type: UTType, orientation: Int? = nil, quality: Double = 0.85) {
  let url = out.appendingPathComponent(name)
  let destination = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil)!
  var properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: quality]
  if let orientation { properties[kCGImagePropertyOrientation] = orientation }
  CGImageDestinationAddImage(destination, image, properties as CFDictionary)
  precondition(CGImageDestinationFinalize(destination), "could not write \(name)")
  print("wrote \(name)")
}

let paper = NSColor(calibratedRed: 0.97, green: 0.96, blue: 0.92, alpha: 1)
let ink = NSColor(calibratedWhite: 0.12, alpha: 1)

// 1. A dense page of English text.
let english = """
Small steps compound. Write down one lesson from today, then read it again next week.
The point is not to remember everything, but to meet the right idea at the right time.
Notes you never revisit are a library you never visit. Keep fewer, return more often.
Ask what changed since you last read this, and what you would do differently now.
"""
save(render(width: 1600, height: 1200, background: paper) { _ in
  text("Weekly review", in: CGRect(x: 90, y: 1000, width: 1420, height: 120), size: 72, color: ink, weight: .bold)
  text(english, in: CGRect(x: 90, y: 120, width: 1420, height: 860), size: 44, color: ink)
}, "en-text-heavy.png", .png)

// 2. Romanian with every diacritic.
let romanian = """
Învață să te oprești înainte să fii obosit.
Ș și ț nu sunt ş și ţ: scrie corect, citește încet.
Mâine vei ști mai mult decât astăzi, dacă îți notezi lecția.
"""
save(render(width: 1600, height: 1000, background: paper) { _ in
  text("Lecții învățate", in: CGRect(x: 90, y: 810, width: 1420, height: 120), size: 72, color: ink, weight: .bold)
  text(romanian, in: CGRect(x: 90, y: 120, width: 1420, height: 660), size: 52, color: ink)
}, "ro-diacritics.png", .png)

// 3. A camera JPEG stored sideways with EXIF orientation 6, as phones save portrait shots.
let upright = render(width: 1200, height: 1600, background: paper) { _ in
  text("Rotated note", in: CGRect(x: 80, y: 1380, width: 1040, height: 120), size: 70, color: ink, weight: .bold)
  text("Turn the page before you judge it.\nOrientation matters for reading.", in: CGRect(x: 80, y: 900, width: 1040, height: 420), size: 56, color: ink)
}
let sideways = render(width: 1600, height: 1200, background: paper) { context in
  // Pixels rotated 90° counter-clockwise; orientation 6 tells viewers to turn them back.
  context.translateBy(x: 1600, y: 0)
  context.rotate(by: .pi / 2)
  context.draw(upright, in: CGRect(x: 0, y: 0, width: 1200, height: 1600))
}
save(sideways, "en-rotated-exif6.jpg", .jpeg, orientation: 6)

// 4. Low light: dim text on a dark, noisy background.
var generator = SystemRandomNumberGenerator()
save(render(width: 1600, height: 1000, background: NSColor(calibratedWhite: 0.10, alpha: 1)) { context in
  for _ in 0..<6000 {
    let shade = CGFloat.random(in: 0.05...0.2, using: &generator)
    context.setFillColor(NSColor(calibratedWhite: shade, alpha: 1).cgColor)
    context.fill(CGRect(x: .random(in: 0...1600, using: &generator), y: .random(in: 0...1000, using: &generator), width: 3, height: 3))
  }
  text("Seara, totul pare mai greu.\nDimineața vine cu răspunsuri.", in: CGRect(x: 90, y: 250, width: 1420, height: 500), size: 64, color: NSColor(calibratedWhite: 0.42, alpha: 1), weight: .medium)
}, "ro-low-light.jpg", .jpeg, quality: 0.7)

// 5. A photo-like image with no readable text.
save(render(width: 1600, height: 1200, background: NSColor(calibratedRed: 0.55, green: 0.70, blue: 0.85, alpha: 1)) { context in
  context.setFillColor(NSColor(calibratedRed: 0.30, green: 0.50, blue: 0.30, alpha: 1).cgColor)
  context.fill(CGRect(x: 0, y: 0, width: 1600, height: 420))
  context.setFillColor(NSColor(calibratedRed: 0.98, green: 0.85, blue: 0.40, alpha: 1).cgColor)
  context.fillEllipse(in: CGRect(x: 1150, y: 800, width: 220, height: 220))
}, "no-text.jpg", .jpeg)

// 6. A full-size 12 MP HEIC like an iPhone library photo, for decode/save timing.
save(render(width: 4032, height: 3024, background: paper) { _ in
  text("Full-size photo", in: CGRect(x: 240, y: 2500, width: 3600, height: 300), size: 190, color: ink, weight: .bold)
  text(english, in: CGRect(x: 240, y: 300, width: 3600, height: 2100), size: 120, color: ink)
}, "en-12mp.heic", .heic, quality: 0.8)
