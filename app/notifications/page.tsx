import { Bell } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export default function NotificationsPage() {
  return (
    <ComingSoon
      icon={Bell}
      title="Notifications are next"
      description="Signals, replies, and Constellation pings, all in one place — with onchain-verified badge and reputation-tier alerts."
    />
  );
}
