import ExpoModulesCore
import ImageIO
import UniformTypeIdentifiers

final class UnreadableImageException: Exception {
  override var reason: String { "The photo could not be read." }
}

final class ImageWriteException: Exception {
  override var reason: String { "The photo could not be prepared." }
}

public class ResurfaceImageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ResurfaceImage")

    AsyncFunction("downscaleToJpeg") { (uri: URL, destination: URL, maxEdge: Int, quality: Double) throws -> [String: Int] in
      let image = try Self.decode(uri, maxEdge: maxEdge)
      guard let output = CGImageDestinationCreateWithURL(destination as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
        throw ImageWriteException()
      }
      // No properties are copied, so location and other metadata are not kept.
      CGImageDestinationAddImage(output, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
      guard CGImageDestinationFinalize(output) else { throw ImageWriteException() }
      return ["width": image.width, "height": image.height]
    }
  }

  /// Decodes at most `maxEdge` pixels on the longest side, upright. ImageIO decodes HEIC and JPEG
  /// directly at the reduced size instead of decoding the full photo first. Never upscales.
  static func decode(_ uri: URL, maxEdge: Int) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(uri as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else {
      throw UnreadableImageException()
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxEdge,
      kCGImageSourceShouldCacheImmediately: true,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw UnreadableImageException()
    }
    return image
  }
}
