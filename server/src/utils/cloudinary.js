const cloudinary = require("cloudinary").v2;
const path = require("path");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

async function uploadFile(filePath, folder) {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return {
      secure_url: `/${filePath.split(path.sep).join("/")}`,
      public_id: `${folder}/${path.basename(filePath)}`,
      local: true
    };
  }

  return cloudinary.uploader.upload(filePath, {
    folder,
    resource_type: "auto",
    overwrite: true
  });
}

module.exports = { uploadFile };
