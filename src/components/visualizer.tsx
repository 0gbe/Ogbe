import { useEffect, useRef } from "react";

const BAR_COUNT = 28;

export function Visualizer({
  analyser,
  active,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const binsRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const bars = Array.from(wrap.querySelectorAll<HTMLSpanElement>("[data-bar]"));

    const draw = () => {
      const binCount = analyser?.frequencyBinCount ?? 128;
      if (!binsRef.current || binsRef.current.length !== binCount) {
        binsRef.current = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
      }
      const bins = binsRef.current;
      if (analyser) analyser.getByteFrequencyData(bins);
      else bins.fill(0);

      const nyquist = bins.length;
      const start = 2;
      for (let i = 0; i < bars.length; i++) {
        const t = i / Math.max(1, BAR_COUNT - 1);
        const from = start + Math.floor(Math.pow(t, 1.55) * (nyquist - start - 4));
        const to =
          start + Math.floor(Math.pow((i + 1) / BAR_COUNT, 1.55) * (nyquist - start - 2));
        let sum = 0;
        let count = 0;
        for (let k = from; k <= to && k < nyquist; k++) {
          sum += bins[k] ?? 0;
          count++;
        }
        const mag = count ? sum / count / 255 : 0;
        const idle = active ? 0.08 : 0.06;
        const h = Math.max(idle, mag) * 100;
        const bar = bars[i];
        if (bar) {
          bar.style.height = `${h}%`;
          bar.style.opacity = String(0.35 + mag * 0.65);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, active]);

  return (
    <div
      ref={wrapRef}
      className="flex h-24 w-full items-end gap-1 overflow-hidden rounded-lg bg-bg px-2 py-2"
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i / (BAR_COUNT - 1);
        const tone = t < 0.45 ? "bg-lilac" : t < 0.78 ? "bg-primary" : "bg-accent";
        return (
          <span
            key={i}
            data-bar
            className={`min-h-1 flex-1 rounded-sm ${tone}`}
            style={{ height: "8%" }}
          />
        );
      })}
    </div>
  );
}
