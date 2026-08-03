import { MessageCircle } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export default function MessagesPage() {
  return (
    <ComingSoon
      icon={MessageCircle}
      title="Messages are next"
      description="Wallet-to-wallet encrypted DMs and group chats, gated by shared badges or token ownership. In design now."
    />
  );
}
