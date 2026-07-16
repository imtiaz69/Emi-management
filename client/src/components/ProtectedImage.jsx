import { useEffect, useState } from "react";
import { api, normalizeApiPath } from "../api/http";

export default function ProtectedImage({ src, alt, className, fallback = null }) {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!src) {
      setObjectUrl("");
      return undefined;
    }

    let active = true;
    let nextUrl = "";

    api
      .get(normalizeApiPath(src), { responseType: "blob" })
      .then((response) => {
        nextUrl = URL.createObjectURL(response.data);
        if (active) {
          setObjectUrl(nextUrl);
        } else {
          URL.revokeObjectURL(nextUrl);
        }
      })
      .catch(() => {
        if (active) setObjectUrl("");
      });

    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [src]);

  if (!src || !objectUrl) return fallback;

  return <img className={className} src={objectUrl} alt={alt} />;
}
