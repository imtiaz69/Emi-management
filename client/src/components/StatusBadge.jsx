export default function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{String(status || "unknown").replaceAll("_", " ")}</span>;
}
