/**
 * 押すと、その名前の場所へ行ける文字。
 *
 * 曲の行や札の中に置く。外側を押せば曲が鳴るので、
 * こちらを押したときは、その先が上へ伝わらないようにする。
 * 押せるものを入れ子にすると読み上げの筋が通らなくなるので、
 * 見た目ではなく役割で「行き先」だと示す。
 */
export function LinkedName({ label, onOpen }: { label: string; onOpen?: () => void }) {
  if (!onOpen) return <>{label}</>;
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.stopPropagation();
        event.preventDefault();
        onOpen();
      }}
      /*
       * 指で触る場では、押し始めた時点で外側が動き出すことがある。
       * ここを押したぶんは、外側の長押しにも数えない。
       */
      onPointerDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      className="cursor-pointer hover:text-ink hover:underline"
    >
      {label}
    </span>
  );
}
