import { Sparkles } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export default function ConstellationPage() {
  return (
    <ComingSoon
      icon={Sparkles}
      title="Constellation is next"
      description="A living map of your onchain social graph on Robinhood Chain — mutuals, shared wallet clusters, and the people orbiting yours, visualized in real time."
    />
  );
}
