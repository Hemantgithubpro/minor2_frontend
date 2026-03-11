"use client";

interface ConnectionBadgeProps {
  status: "connected" | "reconnecting" | "offline";
}

const LABELS: Record<ConnectionBadgeProps["status"], string> = {
  connected: "Connected",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export default function ConnectionBadge({ status }: ConnectionBadgeProps) {
  return (
    <span className={`connection-badge connection-${status}`}>
      {LABELS[status]}
    </span>
  );
}
