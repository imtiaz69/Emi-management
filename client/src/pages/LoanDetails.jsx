import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoanDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scheduleQuery = useQuery({
    queryKey: ["loan-schedule", id],
    queryFn: async () => (await api.get(`/loans/${id}/schedule`)).data,
    enabled: Boolean(id)
  });
  const agreementQuery = useQuery({
    queryKey: ["loan-agreement", id],
    queryFn: async () => (await api.get(`/loans/${id}/agreement`)).data,
    enabled: Boolean(id)
  });
  const acceptAgreement = useMutation({
    mutationFn: async () => api.patch(`/loans/${id}/agreement/accept`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loan-agreement", id] })
  });

  const schedule = scheduleQuery.data || [];
  const firstRow = schedule[0] || {};
  const agreement = agreementQuery.data;
  const acceptedForRole = user?.role === "buyer" ? agreement?.acceptedByBuyerAt : user?.role === "seller" ? agreement?.acceptedBySellerAt : true;

  return (
    <section className="dashboard">
      <div className="page-title">
        <div>
          <h1>Loan Schedule</h1>
          <p>Review installment status, due dates, and payment progress for this loan.</p>
        </div>
        <Link className="button secondary" to={"/"}>Back to marketplace</Link>
      </div>

      <section className="panel">
        <div className="form-grid compact">
          <div>
            <strong>Loan ID</strong>
            <p>{id}</p>
          </div>
          <div>
            <strong>Buyer</strong>
            <p>{firstRow.buyerId?.name || "-"}</p>
          </div>
          <div>
            <strong>Seller</strong>
            <p>{firstRow.sellerId?.name || "-"}</p>
          </div>
          <div>
            <strong>Status</strong>
            <p><StatusBadge status={firstRow.status || "pending"} /></p>
          </div>
        </div>
      </section>

      {agreement && (
        <section className="panel">
          <h2>Loan agreement</h2>
          <div className="form-grid compact">
            <div>
              <strong>Agreement no</strong>
              <p>{agreement.agreementNo}</p>
            </div>
            <div>
              <strong>Buyer acceptance</strong>
              <p>{agreement.acceptedByBuyerAt ? dayjs(agreement.acceptedByBuyerAt).format("DD MMM YYYY, h:mm A") : "Pending"}</p>
            </div>
            <div>
              <strong>Seller acceptance</strong>
              <p>{agreement.acceptedBySellerAt ? dayjs(agreement.acceptedBySellerAt).format("DD MMM YYYY, h:mm A") : "Pending"}</p>
            </div>
          </div>
          <pre className="agreement-terms">{agreement.terms}</pre>
          {["buyer", "seller"].includes(user?.role) && (
            <div className="button-row">
              <button className="button" disabled={Boolean(acceptedForRole) || acceptAgreement.isPending} onClick={() => acceptAgreement.mutate()}>
                {acceptedForRole ? "Agreement accepted" : "Accept agreement"}
              </button>
              <button className="button secondary" onClick={() => window.print()}>Print / save PDF</button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Installment schedule</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Due date</th>
                <th>Principal amount</th>
                <th>Interest amount</th>
                <th>Late fee</th>
                <th>Total due</th>
                <th>Amount paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: "center", color: "#888" }}>No schedule available</td></tr>
              ) : (
                schedule.map((row) => (
                  <tr key={row._id}>
                    <td>{row.installmentNo}</td>
                    <td>{dayjs(row.dueDate).format("DD MMM YYYY")}</td>
                    <td>BDT {row.principalAmount}</td>
                    <td>BDT {row.interestAmount}</td>
                    <td>BDT {row.lateFee}</td>
                    <td>BDT {row.amountDue}</td>
                    <td>BDT {row.amountPaid}</td>
                    <td><StatusBadge status={row.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
