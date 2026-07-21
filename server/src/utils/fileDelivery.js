const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { getSignedDeliveryUrl } = require("./cloudinary");

async function sendProtectedFile(res, file, { defaultName = "file", invalidPathMessage = "Invalid file path" } = {}) {
  const signedUrl = file.publicId && file.resourceType && getSignedDeliveryUrl(file.publicId, file.resourceType);
  if (signedUrl) return sendRemoteFile(res, signedUrl, file, defaultName);

  if (/^https?:\/\//i.test(file.path)) {
    return sendRemoteFile(res, file.path, file, defaultName);
  }

  const uploadsRoot = path.resolve(process.env.UPLOAD_DIR || "uploads");
  const absolutePath = path.resolve(file.path.replace(/^\/uploads\//, `${uploadsRoot}/`));
  if (!absolutePath.startsWith(uploadsRoot)) return res.status(400).json({ message: invalidPathMessage });

  setInlineFileHeaders(res, file, defaultName);
  return res.sendFile(absolutePath);
}

async function sendRemoteFile(res, url, file, defaultName) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error("Unable to load stored file");
    error.status = 502;
    throw error;
  }

  setInlineFileHeaders(res, file, defaultName);
  res.setHeader("Content-Type", response.headers.get("content-type") || file.mimetype || "application/octet-stream");
  const contentLength = response.headers.get("content-length");
  if (contentLength) res.setHeader("Content-Length", contentLength);

  if (!response.body) return res.status(502).json({ message: "Stored file returned an empty response" });
  return pipeline(Readable.fromWeb(response.body), res);
}

function setInlineFileHeaders(res, file, defaultName) {
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName || file.filename || defaultName)}"`);
  if (file.mimetype) res.setHeader("Content-Type", file.mimetype);
}

module.exports = { sendProtectedFile };
