const cloudinary = require("cloudinary").v2;
const path = require("path");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

async function uploadFile(filePath, folder, { private: isPrivate = false } = {}) {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return {
      secure_url: `/${filePath.split(path.sep).join("/")}`,
      public_id: `${folder}/${path.basename(filePath)}`,
      resource_type: "local",
      local: true
    };
  }

  const result = await cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: "auto",
    overwrite: true,
    ...(isPrivate ? { type: "authenticated" } : {})
  });

  if (isPrivate) {
    result.secure_url = getSignedDeliveryUrl(result.public_id, result.resource_type);
  }

  return result;
}

async function deleteUploadedFile(file = {}) {
  if (!file.path) return;
  if (file.resourceType === "local" || file.path.startsWith("/uploads/")) {
    const localPath = file.path.replace(/^\/uploads\//, `${process.env.UPLOAD_DIR || "uploads"}/`);
    await require("fs").promises.unlink(localPath).catch(() => {});
    return;
  }
  if (file.publicId && process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    await cloudinary.uploader.destroy(file.publicId, { resource_type: file.resourceType || "image" }).catch(() => {});
  }
}

function getSignedDeliveryUrl(publicId, resourceType = "image") {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return null;
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    sign_url: true,
    secure: true
  });
}

module.exports = { deleteUploadedFile, getSignedDeliveryUrl, uploadFile };
