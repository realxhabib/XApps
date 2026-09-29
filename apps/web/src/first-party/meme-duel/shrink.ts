/**
 * Browser-side: the setup screen shrinks a dropped image before `media.upload`.
 * (A copy of the host's old helper: first-party apps only use the public SDK.)
 */

export interface ScaledImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Re-encodes an image as JPEG no larger than `maxSide` on its long edge and
 * roughly `maxBytes`, stepping quality (then size) down until it fits. Also
 * strips EXIF (location etc.) because only the pixels survive the canvas.
 */
export async function shrinkImage(file: Blob, { maxSide = 1080, maxBytes = 900_000 } = {}): Promise<ScaledImage> {
  if (!/^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(file.type)) throw new Error("That file isn't an image");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image");
  }
  try {
    if (bitmap.width < 16 || bitmap.height < 16) throw new Error("That image is too small");
    let side = maxSide;
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Couldn't process that image");
      ctx.fillStyle = "#fff"; // transparent PNGs get a white backdrop, like X shows them
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.86, 0.76, 0.66]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= maxBytes) return { blob, width, height };
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("That image is too detailed to use — try a smaller one");
  } finally {
    bitmap.close();
  }
}
