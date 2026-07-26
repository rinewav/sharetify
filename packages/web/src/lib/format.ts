export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatTotalDuration(msList: (number | undefined)[]): string {
  const total = msList.reduce<number>((sum, ms) => sum + (ms ?? 0), 0);
  const minutes = Math.round(total / 60000);
  if (minutes < 60) return `約 ${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `約 ${hours} 時間` : `約 ${hours} 時間 ${rest} 分`;
}
