export function AuroraBackdrop() {
  return (
    <div className="aurora-bg">
      <div
        className="aurora-blob animate-drift"
        style={{
          top: "-10%",
          left: "-5%",
          width: 520,
          height: 520,
          background: "var(--color-lime)",
        }}
      />
      <div
        className="aurora-blob animate-drift"
        style={{
          top: "20%",
          right: "-10%",
          width: 460,
          height: 460,
          background: "var(--color-moss)",
          animationDelay: "4s",
        }}
      />
      <div
        className="aurora-blob animate-drift"
        style={{
          bottom: "-15%",
          left: "20%",
          width: 400,
          height: 400,
          background: "var(--color-lime-soft)",
          opacity: 0.2,
          animationDelay: "9s",
        }}
      />
    </div>
  );
}
