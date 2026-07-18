export default function BrandMark({ compact = false, className = "" }) {
  return (
    <span className={`brand-lockup ${compact ? "compact" : ""} ${className}`.trim()} aria-label="FinanceLend">
      <span className="brand-monogram" aria-hidden="true">
        <span>F</span>
        <span>L</span>
      </span>
      {!compact && (
        <span className="brand-wordmark">
          <strong>Finance<span>Lend</span></strong>
          <small>EMI &amp; Loan Platform</small>
        </span>
      )}
    </span>
  );
}
