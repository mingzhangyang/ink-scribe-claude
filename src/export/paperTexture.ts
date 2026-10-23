const textureCache = new Map<string, Promise<string>>();

function rasterizeTexture(url: string): Promise<string> {
  let pending = textureCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => finish(new Error("Paper texture loading timed out")), 15_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        image.onload = null;
        image.onerror = null;
        if (error) reject(error);
      };
      image.onerror = () => finish(new Error("Paper texture could not be loaded"));
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext("2d");
          if (!context || !canvas.width || !canvas.height) throw new Error("Paper texture could not be rendered");
          context.drawImage(image, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          finish();
          resolve(dataUrl);
        } catch (error) {
          finish(error instanceof Error ? error : new Error("Paper texture could not be rendered"));
        }
      };
      image.src = url;
    });
    textureCache.set(url, pending);
    void pending.catch(() => textureCache.delete(url));
  }
  return pending;
}

/**
 * Chromium can paint SVG filter textures black when nested inside an exported SVG
 * foreignObject. Rasterize only our embedded texture tiles on the detached snapshot.
 * Alpha, tile dimensions, gradients, and the paper color remain unchanged. A failed
 * tile rejects the export; this never fetches external resources or alters the preview.
 */
export async function preparePaperTexture(snapshot: HTMLElement): Promise<void> {
  const background = getComputedStyle(snapshot).backgroundImage;
  const textures = [...background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)]
    .map((match) => ({ css: match[0], url: (match[1] ?? match[2] ?? match[3]).trim() }))
    .filter(({ url }) => url.startsWith("data:image/svg+xml"));
  if (!textures.length) return;
  const images = await Promise.all(textures.map(({ url }) => rasterizeTexture(url)));
  snapshot.style.backgroundImage = textures.reduce(
    (css, texture, index) => css.replace(texture.css, `url("${images[index]}")`),
    background,
  );
}
