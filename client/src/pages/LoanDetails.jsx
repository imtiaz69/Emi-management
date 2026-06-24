import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { api } from "../api/http";
import StatusBadge from "../components/StatusBadge.jsx";

export default function LoanDetails() {
  const { id } = useParams();
  const scheduleQuery = useQuery({
    queryKey: ["loan-schedule", id],
    queryFn: async () => (await api.get(`/loans/${id}/schedule`)).data,
    enabled: Boolean(id)
  });

  const schedule = scheduleQuery.data || [];
  const firstRow = schedule[0] || {};

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
