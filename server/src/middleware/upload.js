const fs = require("fs");
const path = require("path");
const multer = require("multer");

function createUploader(folder) {
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
    limits: { fileSize: 5 * 1024 * 1024, files: 5 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["image/jpeg", "image/png", "application/pdf"];
      cb(null, allowed.includes(file.mimetype));
    }
  });
}

module.exports = { createUploader };
