const clamp = value => Math.max(0, Math.min(1, value));

// Projects a painted Skin-atlas mask into a component BLP. Rectangles are
// normalized source coordinates; destination always spans the component BLP.
export class AtlasComponentTransferService {
  projectMask(sourceMask, sourceWidth, sourceHeight, rect, targetWidth, targetHeight, protectedMask = null) {
    const out = new Uint8Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
      const u = rect.x + ((x + .5) / targetWidth) * rect.width;
      const v = rect.y + ((y + .5) / targetHeight) * rect.height;
      const sx = Math.min(sourceWidth - 1, Math.max(0, Math.floor(clamp(u) * sourceWidth)));
      const sy = Math.min(sourceHeight - 1, Math.max(0, Math.floor(clamp(v) * sourceHeight)));
      const targetIndex = y * targetWidth + x;
      out[targetIndex] = protectedMask?.[targetIndex] ? 0 : sourceMask[sy * sourceWidth + sx];
    }
    return out;
  }
}
