import { ChartNoAxesCombined, ChevronRight, CircleDollarSign, TrendingUp, TriangleAlert } from "lucide-react";

const toneIcons = {
  blue: ChartNoAxesCombined,
  green: TrendingUp,
  purple: CircleDollarSign,
  red: TriangleAlert
};

export default function StatCard({
  label,
  value,
  tone = "blue",
  icon: Icon = toneIcons[tone] || ChartNoAxesCombined,
  caption,
  onClick
}) {
  const content = (
    <>
      <span className="stat-card-icon"><Icon size={20} /></span>
      <span className="stat-card-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        {caption && <small>{caption}</small>}
      </span>
      {onClick && <ChevronRight className="stat-card-action" size={18} aria-hidden="true" />}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={`stat-card stat-card-button ${tone}`} onClick={onClick} aria-label={`Open ${label} details`}>
        {content}
      </button>
    );
  }

  return (
    <div className={`stat-card ${tone}`}>
      {content}
    </div>
  );
}
