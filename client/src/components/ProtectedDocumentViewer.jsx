import { useEffect, useState } from "react";
import { api, normalizeApiPath } from "../api/http";
import { notifyError } from "../utils/toast";

export default function ProtectedDocumentViewer({ file, label }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  async function openPreview() {
    if (!file?.downloadUrl) return;
    setLoading(true);
    try {
      const response = await api.get(normalizeApiPath(file.downloadUrl), { responseType: "blob" });
      const contentType = response.headers["content-type"] || file.mimetype || response.data.type || "application/octet-stream";
      const blob = response.data.type ? response.data : new Blob([response.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      setPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return {
          url,
          contentType,
          name: file.originalName || label || "Document"
        };
      });
    } catch (error) {
      notifyError(error, "Unable to preview this document.");
    } finally {
      setLoading(false);
    }
  }

  function closePreview() {
    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  return (
    <>
      <button className="button tiny ghost" type="button" onClick={openPreview} disabled={!file?.downloadUrl || loading}>
        {loading ? "Loading..." : label || file?.originalName || "View document"}
      </button>

      {preview && (
        <div className="modal-backdrop document-preview-backdrop" role="presentation" onClick={closePreview}>
          <div className="panel document-preview-modal" role="dialog" aria-modal="true" aria-label={preview.name} onClick={(event) => event.stopPropagation()}>
            <div className="document-preview-header">
              <div>
                <h2>{preview.name}</h2>
                <p className="hint">Review the buyer document before making the KYC decision.</p>
              </div>
              <button className="button tiny ghost" type="button" onClick={closePreview}>Close</button>
            </div>

            {preview.contentType.startsWith("image/") ? (
              <img className="document-preview-image" src={preview.url} alt={preview.name} />
            ) : preview.contentType.includes("pdf") ? (
              <iframe className="document-preview-frame" title={preview.name} src={preview.url} />
            ) : (
              <div className="empty-state">
                <p>This file type cannot be previewed here.</p>
                <a className="button" href={preview.url} target="_blank" rel="noreferrer">Open file</a>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
