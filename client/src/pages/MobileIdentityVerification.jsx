import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, CreditCard, LoaderCircle, RefreshCcw, ShieldCheck, Smartphone, Video, XCircle } from "lucide-react";
import { api } from "../api/http.js";
import { normalizeIdentityImage } from "../utils/identityImage.js";

const storageKey = "financelend_identity_upload_token";

function verificationHeaders(token) {
  return { Authorization: `Verification ${token}` };
}

function readableAction(action) {
  return { BLINK: "Blink once", TURN_LEFT: "Turn your head left", TURN_RIGHT: "Turn your head right" }[action] || action;
}

export default function MobileIdentityVerification() {
  const [token, setToken] = useState(() => sessionStorage.getItem(storageKey) || "");
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return undefined;
    initializedRef.current = true;
    const linkToken = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    async function initialize() {
      try {
        if (linkToken) {
          setError("");
          const { data } = await api.post("/identity-verifications/mobile/exchange", { token: linkToken });
          sessionStorage.setItem(storageKey, data.uploadToken);
          setToken(data.uploadToken);
          setSession(data.session);
        } else if (token) {
          const { data } = await api.get("/identity-verifications/mobile/session", { headers: verificationHeaders(token) });
          setSession(data);
        } else {
          setError("This verification link is missing or has already been consumed.");
        }
      } catch (requestError) {
        sessionStorage.removeItem(storageKey);
        setError(requestError.response?.data?.message || "This verification link is invalid or expired.");
      }
    }
    initialize();
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function uploadArtifact(kind, file, captureMode) {
    setBusy(true);
    setError("");
    try {
      const normalizedFile = await normalizeIdentityImage(file, kind === "front" ? "NID front" : kind === "back" ? "NID back" : "selfie");
      const { data: signed } = await api.post(
        "/identity-verifications/mobile/upload-signature",
        { kind, captureMode },
        { headers: verificationHeaders(token) }
      );
      const form = new FormData();
      form.append("file", normalizedFile);
      Object.entries(signed.params).forEach(([key, value]) => form.append(key, String(value)));
      form.append("api_key", signed.apiKey);
      form.append("signature", signed.signature);
      const cloudinaryResponse = await fetch(`https://api.cloudinary.com/v1_1/${signed.cloudName}/${signed.resourceType}/upload`, { method: "POST", body: form });
      if (!cloudinaryResponse.ok) {
        const failure = await cloudinaryResponse.json().catch(() => ({}));
        throw new Error(failure.error?.message || "Secure upload failed. Please recapture the file.");
      }
      const uploaded = await cloudinaryResponse.json();
      const { data } = await api.post(
        "/identity-verifications/mobile/artifacts",
        { kind, publicId: uploaded.public_id, captureMode },
        { headers: verificationHeaders(token) }
      );
      setSession(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Unable to upload this capture.");
    } finally {
      setBusy(false);
    }
  }

  async function removeArtifact(kind) {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.delete(`/identity-verifications/mobile/artifacts/${kind}`, { headers: verificationHeaders(token) });
      setSession(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to remove this capture.");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraReady(true);
    } catch {
      setError("Live camera is unavailable. Use the selfie fallback below.");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setError("Video recording is not supported on this browser. Use selfie fallback.");
      return;
    }
    const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      setRecordedBlob(blob);
      setRecording(false);
    };
    recorderRef.current = recorder;
    recorder.start(500);
    setRecording(true);
    setTimeout(() => recorder.state === "recording" && recorder.stop(), 8000);
  }

  async function submitRecording() {
    const extension = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
    await uploadArtifact("liveness", new File([recordedBlob], `liveness.${extension}`, { type: recordedBlob.type }), "video");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setCameraReady(false);
  }

  async function complete() {
    setBusy(true);
    try {
      const { data } = await api.post("/identity-verifications/mobile/complete", {}, { headers: verificationHeaders(token) });
      setSession(data);
      sessionStorage.removeItem(storageKey);
      setToken("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to submit verification.");
    } finally {
      setBusy(false);
    }
  }

  const documentOnly = session?.verificationType === "nid_cross_check" || ["document_only", "document_selfie"].includes(session?.captureMode);
  const nidCrossCheck = session?.verificationType === "nid_cross_check";
  const completeCapture = documentOnly
    ? session?.captures?.front
    : session?.captures?.front && session?.captures?.back && session?.captures?.liveness;
  const submitted = ["QUEUED", "WAKING_AI", "PROCESSING", "COMPLETED"].includes(session?.status);

  return (
    <main className="mobile-identity-page">
      <header className="mobile-identity-header">
        <div className="mobile-identity-mark"><ShieldCheck size={25} /></div>
        <div><strong>FinanceLend</strong><span>Secure identity cross-validation</span></div>
      </header>

      <section className="mobile-identity-content">
        {error && <div className="mobile-capture-error"><XCircle size={19} /><span>{error}</span></div>}
        {!session && !error && <div className="mobile-loading"><LoaderCircle className="spin" /><p>Opening secure session...</p></div>}

        {session && !submitted && (
          <>
            <div className="mobile-identity-title"><span>Private session</span><h1>{documentOnly ? "Capture the front of your NID" : "Capture your identity evidence"}</h1><p>{documentOnly ? "Use the rear camera and keep the full card clear, flat, and readable." : "Your raw captures are removed automatically after the review period."}</p></div>
            <div className="mobile-capture-steps">
              <label className={`mobile-capture-card ${session.captures?.front ? "complete" : ""}`}>
                <span className="mobile-step-number">1</span><CreditCard size={25} />
                <span><strong>Front of NID</strong><small>Place the card on a flat surface with all text visible.</small></span>
                {session.captures?.front ? <CheckCircle2 className="capture-check" /> : <Camera className="capture-action" />}
                {session.captures?.front && <button type="button" className="mobile-remove-capture" title="Remove NID front" aria-label="Remove NID front" disabled={busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeArtifact("front"); }}><XCircle size={18} /></button>}
                <input key={`front-${Boolean(session.captures?.front)}`} type="file" accept="image/*" capture="environment" disabled={busy} onChange={(event) => event.target.files?.[0] && uploadArtifact("front", event.target.files[0])} />
              </label>
              {!documentOnly && <label className={`mobile-capture-card ${session.captures?.back ? "complete" : ""}`}>
                <span className="mobile-step-number">2</span><CreditCard size={25} />
                <span><strong>Back of NID</strong><small>Keep the complete QR code sharp and inside the frame.</small></span>
                {session.captures?.back ? <CheckCircle2 className="capture-check" /> : <Camera className="capture-action" />}
                {session.captures?.back && <button type="button" className="mobile-remove-capture" title="Remove NID back" aria-label="Remove NID back" disabled={busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeArtifact("back"); }}><XCircle size={18} /></button>}
                <input key={`back-${Boolean(session.captures?.back)}`} type="file" accept="image/*" capture="environment" disabled={busy} onChange={(event) => event.target.files?.[0] && uploadArtifact("back", event.target.files[0])} />
              </label>}
              {!documentOnly && <div className={`mobile-capture-card face-card ${session.captures?.liveness ? "complete" : ""}`}>
                <span className="mobile-step-number">3</span><Smartphone size={25} />
                <span><strong>Live face</strong><small>Keep only your face visible and follow the actions in order.</small></span>
                {session.captures?.liveness ? <CheckCircle2 className="capture-check" /> : <Video className="capture-action" />}
              </div>}
              {nidCrossCheck && <label className={`mobile-capture-card ${session.captures?.liveness ? "complete" : ""}`}>
                <span className="mobile-step-number">2</span><Smartphone size={25} />
                <span><strong>Live selfie (optional)</strong><small>Look directly at the camera to add a 60% face-similarity check.</small></span>
                {session.captures?.liveness ? <CheckCircle2 className="capture-check" /> : <Camera className="capture-action" />}
                {session.captures?.liveness && <button type="button" className="mobile-remove-capture" title="Remove selfie" aria-label="Remove selfie" disabled={busy} onClick={(event) => { event.preventDefault(); event.stopPropagation(); removeArtifact("liveness"); }}><XCircle size={18} /></button>}
                <input key={`selfie-${Boolean(session.captures?.liveness)}`} type="file" accept="image/*" capture="user" disabled={busy} onChange={(event) => event.target.files?.[0] && uploadArtifact("liveness", event.target.files[0], "selfie")} />
              </label>}
            </div>

            {!documentOnly && !session.captures?.liveness && (
              <section className="mobile-camera-panel">
                <div className="liveness-challenge">
                  {(session.challenge || []).map((action, index) => <span key={`${action}-${index}`}><b>{index + 1}</b>{readableAction(action)}</span>)}
                </div>
                <video ref={videoRef} muted playsInline className={cameraReady ? "visible" : ""} />
                {!cameraReady && <button className="button" onClick={startCamera}><Camera size={17} /> Open front camera</button>}
                {cameraReady && !recording && !recordedBlob && <button className="button" onClick={startRecording}><Video size={17} /> Record 8-second challenge</button>}
                {recording && <div className="recording-indicator"><span /> Recording: perform the actions now</div>}
                {recordedBlob && <div className="button-row"><button className="button" onClick={submitRecording} disabled={busy}>Use this video</button><button className="button secondary" onClick={() => setRecordedBlob(null)}><RefreshCcw size={16} /> Record again</button></div>}
                <label className="selfie-fallback">Camera video unavailable? Use selfie fallback
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="user" disabled={busy} onChange={(event) => event.target.files?.[0] && uploadArtifact("liveness", event.target.files[0], "selfie")} />
                </label>
              </section>
            )}

            <button className="button mobile-submit" disabled={!completeCapture || busy} onClick={complete}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />} {documentOnly ? "Submit NID for verification" : "Submit for secure cross-check"}
            </button>
          </>
        )}

        {session && submitted && (
          <div className="mobile-submitted">
            <CheckCircle2 size={48} />
            <h1>Captures submitted</h1>
            <p>The secure session is now {session.status.replaceAll("_", " ").toLowerCase()}. You may close this page and return to the laptop.</p>
          </div>
        )}
      </section>
      <footer className="mobile-identity-footer">This process compares supplied evidence. It does not query a government identity database.</footer>
    </main>
  );
}
