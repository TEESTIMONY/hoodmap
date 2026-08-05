// Loading indicator built from the same bubbles HoodMap itself renders
// (same gradient/glow helpers, same color-assignment logic) — while a scan
// is running, this doubles as a small preview of the feature it's building
// toward, rather than a generic spinner unrelated to the product.

import { assignClusterColors, bubbleGlowCss, bubbleGradientCss } from "@/lib/scan/hoodmap-layout";

// An arc — small, bigger, biggest, bigger, small — reads more like "alive
// bubbles" than a row of identical dots.
const BUBBLE_SIZES = [12, 18, 26, 18, 12];

export function BubbleLoader({ label, className }: { label?: string; className?: string }) {
  const colors = assignClusterColors(BUBBLE_SIZES.map((_, i) => `bubble-loader-${i}`));

  return (
    <div className={`flex flex-col items-center gap-3 ${className ?? ""}`}>
      <div className="flex items-end gap-2.5">
        {BUBBLE_SIZES.map((size, i) => {
          const color = colors.get(`bubble-loader-${i}`)!;
          return (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: size,
                height: size,
                background: bubbleGradientCss(color),
                boxShadow: bubbleGlowCss(color, size / 2, 1.3),
                animation: "bubble-loading-bounce 1.1s ease-in-out infinite",
                animationDelay: `${i * 0.12}s`,
              }}
            />
          );
        })}
      </div>
      {label && <p className="text-xs text-ink-faint">{label}</p>}
    </div>
  );
}
