import { User } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export default function ProfilePage() {
  return (
    <ComingSoon
      icon={User}
      title="Profiles are next"
      description="A verified identity for your wallet — trade history, HoodScore, reputation tier, and badges, all in one shareable place."
    />
  );
}
