const fs = require("fs");
const path = require("path");
const multer = require("multer");

const policies = {
  products: {
    maxFiles: 5,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".webp", ".avif"]
  },
  kyc: {
    maxFiles: 11,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "application/pdf"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".pdf"]
  },
  profiles: {
    maxFiles: 1,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".webp", ".avif"]
  }
};

function createUploader(folder, overridePolicy = {}) {
  const policy = { ...(policies[folder] || policies.products), ...overridePolicy };
  const root = process.env.UPLOAD_DIR || "uploads";
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: policy.maxFileSize || 5 * 1024 * 1024, files: policy.maxFiles },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = policy.allowedMimeTypes.includes(file.mimetype) && policy.allowedExtensions.includes(ext);
      if (!allowed) return cb(new Error(`Unsupported file type: ${ext || file.mimetype}`));
      return cb(null, true);
    }
  });
}

async function assertUploadedFilesSafe(files = []) {
  const flatFiles = Array.isArray(files) ? files : Object.values(files).flat();
  await Promise.all(flatFiles.filter(Boolean).map(assertFileSignatureSafe));
}

async function assertFileSignatureSafe(file) {
  const fd = await fs.promises.open(file.path, "r");
  try {
    const buffer = Buffer.alloc(12);
    await fd.read(buffer, 0, 12, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    const isPng = buffer.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPdf = buffer.slice(0, 4).toString() === "%PDF";
    const isWebp = buffer.slice(0, 4).toString() === "RIFF";
    const fileTypeBox = buffer.slice(4, 12).toString();
    const isAvif = fileTypeBox.startsWith("ftyp") && fileTypeBox.includes("avif");
    const valid = ([".jpg", ".jpeg"].includes(ext) && isJpg) || (ext === ".png" && isPng) || (ext === ".pdf" && isPdf) || (ext === ".webp" && isWebp) || (ext === ".avif" && isAvif);
    if (!valid) {
      await fs.promises.unlink(file.path).catch(() => {});
      const error = new Error(`File signature does not match extension for ${file.originalname}`);
      error.status = 400;
      throw error;
    }
  } finally {
    await fd.close();
  }
}

module.exports = { assertUploadedFilesSafe, createUploader };
