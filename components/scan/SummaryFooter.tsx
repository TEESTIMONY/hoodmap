import { GlassPanel } from "@/components/ui/GlassPanel";
import type { DataSources } from "@/lib/scan/types";

export function SummaryFooter({
  aiSummary,
  dataSources,
}: {
  aiSummary: string;
  dataSources: DataSources;
}) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-2 text-sm font-medium text-ink">Summary</div>
      <p className="text-sm leading-relaxed text-ink-muted">{aiSummary}</p>
      <div className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        {dataSources.provider}
        {dataSources.observationWindowFromBlock != null && (
          <>
            {" "}
            · blocks {dataSources.observationWindowFromBlock.toLocaleString()}–
            {dataSources.observationWindowToBlock?.toLocaleString()}
          </>
        )}
        {dataSources.notes?.map((note, i) => (
          <div key={i} className="mt-1">
            {note}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
