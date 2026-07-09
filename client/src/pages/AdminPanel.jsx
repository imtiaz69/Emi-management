import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api, openProtectedFile } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";

export default function AdminPanel() {
  const queryClient = useQueryClient();
  const pending = useQuery({ queryKey: ["pending-sellers"], queryFn: async () => (await api.get("/admin/sellers/pending")).data });
  const pendingKyc = useQuery({ queryKey: ["kyc-pending"], queryFn: async () => (await api.get("/kyc/pending")).data });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: async () => (await api.get("/admin/users")).data });
  const audit = useQuery({ queryKey: ["audit"], queryFn: async () => (await api.get("/admin/audit")).data });

  const approve = useMutation({
    mutationFn: async (id) => api.patch(`/admin/sellers/${id}/approve`),
    onSuccess: () => refresh()
  });
  const reject = useMutation({
    mutationFn: async (id) => api.patch(`/admin/sellers/${id}/reject`, { reason: "Incomplete business information" }),
    onSuccess: () => refresh()
  });

  const reviewKyc = useMutation({
    mutationFn: async ({ id, status, rejectionReason }) => api.patch(`/kyc/${id}/review`, { status, rejectionReason }),
    onSuccess: () => refresh()
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["pending-sellers"] });
    queryClient.invalidateQueries({ queryKey: ["kyc-pending"] });
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["audit"] });
  }

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Admin Panel</h1>
          <p>Approve sellers, inspect platform users, and review accountability logs.</p>
        </div>
      </div>
      <div className="work-grid">
        <section className="panel">
          <h2>Pending seller registrations</h2>
          <div className="list-stack">
            {(pending.data || []).map((seller) => (
              <div className="list-row" key={seller._id}>
                <div><strong>{seller.shopName}</strong><span>{seller.userId?.email}</span></div>
                <div className="button-row"><button className="button tiny" onClick={() => approve.mutate(seller._id)}>Approve</button><button className="button tiny danger" onClick={() => reject.mutate(seller._id)}>Reject</button></div>
              </div>
            ))}
            {pending.data?.length === 0 && <p className="hint">No pending sellers.</p>}
          </div>
        </section>
        <section className="panel">
          <h2>KYC Review</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Buyer</th><th>Type</th><th>Documents</th><th>Status</th><th>Reason</th><th>Action</th></tr></thead>
              <tbody>
                {(pendingKyc.data || []).map((doc) => (
                  <tr key={doc._id}>
                    <td><strong>{doc.userId?.name}</strong><br />{doc.userId?.email}</td>
                    <td>{doc.type.toUpperCase()}</td>
                    <td>
                      {(doc.files || []).map((file) => (
                        <div key={file.filename || file.downloadUrl}>
                          <button className="button tiny ghost" type="button" onClick={() => openProtectedFile(file.downloadUrl)}>{file.originalName}</button>
                        </div>
                      ))}
                      {doc.selfie && <div><button className="button tiny ghost" type="button" onClick={() => openProtectedFile(doc.selfie.downloadUrl)}>Selfie</button></div>}
                    </td>
                    <td><StatusBadge status={doc.status} /></td>
                    <td>{doc.rejectionReason || "-"}</td>
                    <td className="button-row">
                      <button className="button tiny" onClick={() => reviewKyc.mutate({ id: doc._id, status: "approved" })}>Approve</button>
                      <button className="button tiny danger" onClick={() => reviewKyc.mutate({ id: doc._id, status: "rejected", rejectionReason: "Invalid document" })}>Reject</button>
                    </td>
                  </tr>
                ))}
                {pendingKyc.data?.length === 0 && <tr><td colSpan="6" style={{ textAlign: "center", color: "#888" }}>No KYC documents pending review.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>Users</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
              <tbody>{(users.data || []).map((user) => <tr key={user._id}><td>{user.name}</td><td>{user.role}</td><td><StatusBadge status={user.status} /></td><td>{dayjs(user.createdAt).format("DD MMM YYYY")}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>Audit trail</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
            <tbody>{(audit.data || []).map((log) => <tr key={log._id}><td>{dayjs(log.createdAt).format("DD MMM HH:mm")}</td><td>{log.actorId?.name || "System"}</td><td>{log.action}</td><td>{log.entityType}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
