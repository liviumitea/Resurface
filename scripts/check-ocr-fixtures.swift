// Runs the OCR fixtures through macOS Vision the way expo-text-extractor calls it on iOS (default
// request, image without its EXIF orientation) and checks each has a usable outcome. macOS Vision
// is a stand-in for iOS; it is not a device measurement and its timings are not device latency.
//   swift scripts/check-ocr-fixtures.swift [tests/fixtures/ocr]
import Foundation
import ImageIO
import Vision

struct Fixture { let file: String; let expect: [String] }
// An empty `expect` means the fixture must read as no text (the app then offers Keep as image).
let fixtures = [
  Fixture(file: "en-text-heavy.png", expect: ["Weekly review", "Small steps compound"]),
  Fixture(file: "ro-diacritics.png", expect: ["Lecții învățate", "Mâine vei ști mai mult decât astăzi", "citește încet"]),
  Fixture(file: "en-rotated-exif6.jpg", expect: ["Rotated note", "Turn the page before you judge it"]),
  Fixture(file: "ro-low-light.jpg", expect: ["Seara, totul pare mai greu", "Dimineața vine cu răspunsuri"]),
  Fixture(file: "no-text.jpg", expect: []),
  Fixture(file: "en-12mp.heic", expect: ["Full-size photo", "Small steps compound"]),
]

let directory = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "tests/fixtures/ocr")

/// expo-text-extractor: UIImage(data:).cgImage (orientation dropped) and a default request.
func recognize(_ url: URL) throws -> String {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreadable \(url.lastPathComponent)"])
  }
  let request = VNRecognizeTextRequest()
  try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

func verdict(_ text: String, _ fixture: Fixture) -> String {
  let flat = text.replacingOccurrences(of: "\n", with: " ")
  if fixture.expect.isEmpty { return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "pass (no text)" : "FAIL: found \"\(flat.prefix(40))\"" }
  let missing = fixture.expect.filter { !flat.contains($0) }
  return missing.isEmpty ? "pass" : "FAIL: missing \(missing.map { "\"\($0)\"" }.joined(separator: ", "))"
}

func timed<T>(_ work: () throws -> T) rethrows -> (T, Int) {
  let start = Date(); let value = try work(); return (value, Int(Date().timeIntervalSince(start) * 1000))
}

var failures = 0
_ = try? recognize(directory.appendingPathComponent(fixtures[0].file)) // warm up: the first call loads the models
for fixture in fixtures {
  let (text, ms) = try timed { try recognize(directory.appendingPathComponent(fixture.file)) }
  let result = verdict(text, fixture)
  if !result.hasPrefix("pass") { failures += 1 }
  print("\(fixture.file): \(result) (\(ms) ms)")
}
print(failures == 0 ? "All fixtures have the expected outcome." : "\(failures) fixture(s) failed.")
exit(failures == 0 ? 0 : 1)
