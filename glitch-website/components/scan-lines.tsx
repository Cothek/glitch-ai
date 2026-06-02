// Hero background — vertical scan lines (reused from existing index.html style).

export function ScanLines({
  count = 80,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  // Pre-compute delays and durations for a non-uniform feel
  const lines = Array.from({ length: count }, (_, i) => {
    const delay = (i * 0.15) % 3;
    const duration = 1.5 + ((i * 0.137) % 3.5);
    const left = (i * (100 / count)).toFixed(3);
    const isPurple = i % 2 === 0;
    return { delay, duration, left, color: isPurple ? "purple" : "cyan" };
  });

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {lines.map((line, i) => (
        <span
          key={i}
          className={`vscan-line ${line.color}`}
          style={
            {
              left: `${line.left}%`,
              "--delay": `${line.delay}s`,
              "--duration": `${line.duration}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
