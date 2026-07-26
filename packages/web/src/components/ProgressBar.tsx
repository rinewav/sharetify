import { useCallback, useRef, useState } from "react";

interface Props {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * シークバー / 音量バー。
 *
 * ドラッグ中は外から来る値を無視して、指の位置を正として描く。
 * そうしないと再生位置の更新に引っ張られてつまみが跳ねる。
 */
export function ProgressBar({ value, max, onChange, disabled = false, className = "" }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const ratioOf = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    },
    [],
  );

  const shown = dragValue ?? value;
  const percent = max > 0 ? Math.min(100, (shown / max) * 100) : 0;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragValue(ratioOf(event.clientX) * max);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || dragValue === null) return;
    setDragValue(ratioOf(event.clientX) * max);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || dragValue === null) return;
    const next = ratioOf(event.clientX) * max;
    setDragValue(null);
    onChange(next);
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDragValue(null)}
      className={`group/bar relative flex h-3 cursor-pointer items-center ${
        disabled ? "pointer-events-none opacity-50" : ""
      } ${className}`}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={disabled ? -1 : 0}
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-ink-muted transition-colors group-hover/bar:bg-accent"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div
        className="absolute size-3 -translate-x-1/2 rounded-full bg-ink opacity-0 shadow transition-opacity group-hover/bar:opacity-100"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}
