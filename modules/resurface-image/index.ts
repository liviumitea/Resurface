import { requireOptionalNativeModule } from "expo";

type ResurfaceImageModule = {
  /** Writes a JPEG of at most maxEdge pixels on the longest side, upright and without metadata. */
  downscaleToJpeg(uri: string, destination: string, maxEdge: number, quality: number): Promise<{ width: number; height: number }>;
};

/** iOS only; null elsewhere, where callers fall back to expo-image-manipulator. */
export default requireOptionalNativeModule<ResurfaceImageModule>("ResurfaceImage");
