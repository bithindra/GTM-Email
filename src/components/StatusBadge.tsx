import type { RecipientStatus } from "@/lib/types";

const MAP: Record<RecipientStatus, { bg: string; color: string; label: string }> = {
  queued: { bg: "#f1f5f9", color: "#475569", label: "Queued" },
  sent: { bg: "#e0e7ff", color: "#4338ca", label: "Sent" },
  delivered: { bg: "#dbeafe", color: "#1d4ed8", label: "Delivered" },
  opened: { bg: "#fef3c7", color: "#b45309", label: "Opened" },
  clicked: { bg: "#cffafe", color: "#0e7490", label: "Clicked" },
  replied: { bg: "#dcfce7", color: "#15803d", label: "Replied" },
  bounced: { bg: "#fee2e2", color: "#b91c1c", label: "Bounced" },
  failed: { bg: "#fee2e2", color: "#b91c1c", label: "Failed" },
};

export default function StatusBadge({ status }: { status: RecipientStatus }) {
  const s = MAP[status] ?? MAP.queued;
  return (
    <span className="badge" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
