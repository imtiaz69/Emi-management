const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2200;

function loadWithImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This phone image format could not be opened. Change the camera format to JPEG or take a screenshot and try again."));
    };
    image.src = url;
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari can decode some camera formats through an image element even
      // when createImageBitmap does not support them.
    }
  }
  return loadWithImageElement(file);
}

export async function normalizeIdentityImage(file, label = "image") {
  if (!file) throw new Error(`Select a ${label} first.`);
  if (file.type && !String(file.type).startsWith("image/")) throw new Error(`The ${label} must be an image.`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`The ${label} is larger than 20 MB.`);

  const source = await decodeImage(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error(`The ${label} dimensions could not be read.`);

  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error(`The ${label} could not be prepared for upload.`);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error(`The ${label} could not be converted to a readable JPEG.`);
  const baseName = String(file.name || label).replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-") || label;
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}
