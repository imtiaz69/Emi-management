import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { CheckCircle2, Clipboard, ExternalLink, Eye, QrCode, RefreshCcw, RotateCcw, ShieldAlert, ShieldCheck, UserSearch, XCircle } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { api, openProtectedFile } from "../api/http.js";
import { useAuth } from "../context/AuthContext.jsx";
import { notifyError, notifySuccess } from "../utils/toast.js";

const activeStatuses = new Set(["CREATED", "CAPTURING", "QUEUED", "WAKING_AI", "PROCESSING"]);

function statusLabel(value = "") {
  return value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function CheckRow({ label, value }) {
  const status = value?.status || "INCONCLUSIVE";
  const Icon = status === "PASS" ? CheckCircle2 : status === "FAIL" ? XCircle : ShieldAlert;
  return (
    <div className={`identity-check identity-${status.toLowerCase()}`}>
      <Icon size={18} />
      <span><strong>{label}</strong>{value?.detail && <small>{value.detail}</small>}</span>
      <b>{statusLabel(status)}</b>
    </div>
  );
}

export default function IdentityVerificationPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [buyerId, setBuyerId] = useState("");
  const [buyerSearch, setBuyerSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [mobileLink, setMobileLink] = useState("");
  const [decisionReason, setDecisionReason] = useState("Reviewed against the submitted evidence.");

  const candidates = useQuery({ queryKey: ["identity-candidates"], queryFn: async () => (await api.get("/identity-verifications/candidates")).data });
  const sessions = useQuery({
    queryKey: ["identity-verifications"],
    queryFn: async () => (await api.get("/identity-verifications")).data,
    refetchInterval: (query) => (query.state.data || []).some((session) => activeStatuses.has(session.status)) ? 3000 : 15000
  });
  const details = useQuery({
    queryKey: ["identity-verification", selectedId],
    queryFn: async () => (await api.get(`/identity-verifications/${selectedId}`)).data,
    enabled: Boolean(selectedId),
    refetchInterval: (query) => activeStatuses.has(query.state.data?.status) ? 2500 : false
  });

  const filteredBuyers = useMemo(() => {
    const search = buyerSearch.trim().toLowerCase();
    return (candidates.data || []).filter((buyer) => `${buyer.name} ${buyer.email} ${buyer.phone}`.toLowerCase().includes(search));
  }, [buyerSearch, candidates.data]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["identity-verifications"] });
    if (selectedId) queryClient.invalidateQueries({ queryKey: ["identity-verification", selectedId] });
  }

  const createSession = useMutation({
    mutationFn: async () => (await api.post("/identity-verifications", { buyerId })).data,
    onSuccess: (session) => {
      setSelectedId(session._id);
      setMobileLink(session.mobileUrl);
      refresh();
      notifySuccess("Secure identity verification session created.");
    },
    onError: (error) => notifyError(error, "Unable to create verification session.")
  });

  const sessionAction = useMutation({
    mutationFn: async ({ id, action }) => (await api.post(`/identity-verifications/${id}/${action}`)).data,
    onSuccess: (session) => {
      if (session.mobileUrl) setMobileLink(session.mobileUrl);
      refresh();
      notifySuccess("Verification session updated.");
    },
    onError: (error) => notifyError(error, "Unable to update verification session.")
  });

  const manualDecision = useMutation({
    mutationFn: async ({ decision }) => (await api.patch(`/identity-verifications/${selectedId}/manual-decision`, { decision, reason: decisionReason })).data,
    onSuccess: () => {
      refresh();
      notifySuccess("Manual identity decision recorded.");
    },
    onError: (error) => notifyError(error, "Unable to record the decision.")
  });

  const selected = details.data || (sessions.data || []).find((session) => session._id === selectedId);
  const result = selected?.result;
  const comparisons = result?.fieldComparisons || {};

  return (
    <div className="identity-workspace">
      <section className="panel identity-intro">
        <div>
          <span className="identity-eyebrow"><ShieldCheck size={15} /> Document and identity cross-validation</span>
          <h2>Start customer verification</h2>
          <p>Compare supplied NID text, legitimately readable QR data, and a live customer face. This is not government database verification.</p>
        </div>
        <div className="identity-start-form">
          <label>Find an existing buyer
            <input value={buyerSearch} onChange={(event) => setBuyerSearch(event.target.value)} placeholder="Search name, email, or phone" />
          </label>
          <label>Select buyer
            <select value={buyerId} onChange={(event) => setBuyerId(event.target.value)}>
              <option value="">Choose a related buyer</option>
              {filteredBuyers.map((buyer) => <option value={buyer._id} key={buyer._id}>{buyer.name} · {buyer.phone}</option>)}
            </select>
          </label>
          <button className="button" disabled={!buyerId || createSession.isPending} onClick={() => createSession.mutate()}>
            <QrCode size={17} /> Start identity verification
          </button>
        </div>
      </section>

      {mobileLink && selected && ["CREATED", "CAPTURING"].includes(selected.status) && (
        <section className="panel identity-qr-panel">
          <div className="identity-qr"><QRCodeCanvas value={mobileLink} size={210} level="M" includeMargin /></div>
          <div>
            <span className="badge pending">Expires {dayjs(selected.expiresAt).format("HH:mm:ss")}</span>
            <h2>Scan with the customer’s phone</h2>
            <p>The link contains a short-lived one-time token. Keep this screen open while the customer captures the evidence.</p>
            <div className="button-row">
              <button className="button secondary" onClick={() => navigator.clipboard.writeText(mobileLink).then(() => notifySuccess("Mobile link copied."))}><Clipboard size={16} /> Copy link</button>
              <a className="button secondary" href={mobileLink} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open mobile page</a>
            </div>
          </div>
        </section>
      )}

      <div className="identity-layout">
        <section className="panel">
          <div className="page-title compact">
            <div><h2>Verification sessions</h2><p>Recent sessions and processing progress.</p></div>
            <button className="dashboard-icon-button" title="Refresh sessions" onClick={refresh}><RefreshCcw size={18} /></button>
          </div>
          <div className="identity-session-list">
            {(sessions.data || []).map((session) => (
              <button className={`identity-session-row ${selectedId === session._id ? "active" : ""}`} key={session._id} onClick={() => setSelectedId(session._id)}>
                <span><strong>{session.buyer?.name || "Buyer"}</strong><small>{dayjs(session.createdAt).format("DD MMM YYYY, HH:mm")}</small></span>
                <span className={`identity-status identity-status-${session.status.toLowerCase()}`}>{statusLabel(session.result?.overallStatus || session.status)}</span>
              </button>
            ))}
            {!sessions.isLoading && !(sessions.data || []).length && <div className="empty-state"><UserSearch size={28} /><p>No identity verification sessions yet.</p></div>}
          </div>
        </section>

        <section className="panel identity-result-panel">
          {!selected && <div className="empty-state"><ShieldCheck size={34} /><p>Select or create a session to view its progress.</p></div>}
          {selected && (
            <>
              <div className="page-title compact">
                <div><h2>{selected.buyer?.name || "Verification details"}</h2><p>{selected.buyer?.email} {selected.buyer?.phone && `· ${selected.buyer.phone}`}</p></div>
                <span className={`identity-status identity-status-${(result?.overallStatus || selected.status).toLowerCase()}`}>{statusLabel(result?.overallStatus || selected.status)}</span>
              </div>

              <div className="identity-capture-progress">
                {[['front', 'NID front'], ['back', 'NID back'], ['liveness', 'Live face']].map(([key, label]) => (
                  <div className={selected.captures?.[key] ? "complete" : ""} key={key}><CheckCircle2 size={18} /><span>{label}</span></div>
                ))}
              </div>

              {["QUEUED", "WAKING_AI", "PROCESSING"].includes(selected.status) && (
                <div className="identity-processing"><span className="spinner" /><div><strong>{statusLabel(selected.status)}</strong><p>Free AI hosting can take a minute to wake after inactivity. This page updates automatically.</p></div></div>
              )}
              {selected.status === "ERROR" && <div className="notice error"><strong>Processing error:</strong> {selected.lastError}</div>}

              {result && (
                <>
                  <div className="identity-checks">
                    <CheckRow label="Front OCR" value={result.checks?.frontOcr} />
                    <CheckRow label="Back QR decoded" value={result.checks?.qrDecoded} />
                    <CheckRow label="NID number match" value={result.checks?.nidNumberMatch} />
                    <CheckRow label="Name match" value={result.checks?.nameMatch} />
                    <CheckRow label="Date of birth match" value={result.checks?.dateOfBirthMatch} />
                    <CheckRow label="Face quality" value={result.checks?.faceQuality} />
                    <CheckRow label="Face match" value={result.checks?.faceMatch} />
                    <CheckRow label="Basic liveness" value={result.checks?.liveness} />
                  </div>
                  <div className="identity-comparison-grid">
                    <div><span>NID number</span><strong>{comparisons.nidNumber?.front || "Unavailable"}</strong><small>QR: {comparisons.nidNumber?.qr || "Unavailable"}</small></div>
                    <div><span>Name similarity</span><strong>{Math.round(Number(result.scores?.nameSimilarity || 0) * 100)}%</strong><small>{comparisons.name?.front || "Unavailable"}</small></div>
                    <div><span>Face similarity</span><strong>{Math.round(Number(result.scores?.faceSimilarity || 0) * 100)}%</strong><small>Threshold {result.thresholds?.faceMatch}</small></div>
                    <div><span>Date of birth</span><strong>{comparisons.dateOfBirth?.front || "Unavailable"}</strong><small>QR: {comparisons.dateOfBirth?.qr || "Unavailable"}</small></div>
                  </div>
                  {!!result.failureReasons?.length && <div className="notice error"><strong>Failure reasons</strong>{result.failureReasons.map((reason) => <p key={reason}>{reason}</p>)}</div>}
                  {!!result.warnings?.length && <div className="notice warning"><strong>Review notes</strong>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
                </>
              )}

              <div className="button-row identity-actions">
                {!selected.purgedAt && selected.captures?.front && <button className="button secondary" onClick={() => openProtectedFile(`/identity-verifications/${selected._id}/artifacts/front`)}><Eye size={16} /> NID front</button>}
                {!selected.purgedAt && selected.captures?.back && <button className="button secondary" onClick={() => openProtectedFile(`/identity-verifications/${selected._id}/artifacts/back`)}><Eye size={16} /> NID back</button>}
                {["EXPIRED", "ERROR"].includes(selected.status) && !selected.captures?.front && <button className="button secondary" onClick={() => sessionAction.mutate({ id: selected._id, action: "renew" })}><RotateCcw size={16} /> New secure link</button>}
                {selected.status === "ERROR" && selected.captures?.front && <button className="button secondary" onClick={() => sessionAction.mutate({ id: selected._id, action: "reprocess" })}><RefreshCcw size={16} /> Reprocess</button>}
              </div>

              {user?.role === "admin" && result && (
                <div className="identity-manual-review">
                  <label>Decision reason<textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label>
                  <div className="button-row">
                    <button className="button" onClick={() => manualDecision.mutate({ decision: "approve" })}>Approve KYC</button>
                    <button className="button danger" onClick={() => manualDecision.mutate({ decision: "reject" })}>Reject</button>
                    <button className="button secondary" onClick={() => manualDecision.mutate({ decision: "revoke" })}>Revoke approval</button>
                    <button className="button secondary" onClick={() => manualDecision.mutate({ decision: "recapture" })}>Request recapture</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
