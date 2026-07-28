import { useCallback, useEffect, useRef } from "react";

/**
 * 指で触ったときの振る舞い。
 *
 * 指しかない端末には右ボタンが無い。押し続けることがその代わりになるので、
 * 長く押したら品書きを出す。下へ払ったら閉じる。
 * どちらも「途中でやめられる」ことが大事で、
 * 少し動かしただけで発動したり、離せなくなったりすると気持ち悪い。
 */

/** これだけ押し続けたら長押しとみなす。 */
const LONG_PRESS_MS = 450;
/** これ以上動いたら、押すのではなく動かすつもりだったとみなす。 */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressBind {
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchCancel: (event: React.TouchEvent) => void;
  /** 長押しの直後に続けて起きる押下を飲む。押したつもりが再生されないように。 */
  onClickCapture: (event: React.MouseEvent) => void;
}

/**
 * 押し続けたら知らせる。
 *
 * 指が動いたら取り消す。画面を送ろうとしただけで品書きが出ると、
 * 一覧をたどるのが怖くなる。
 */
export function useLongPress(
  onLongPress: (x: number, y: number) => void,
  enabled = true,
): LongPressBind {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  /** 直前に長押しが起きたか。続けて来る押下を飲むために持つ。 */
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onTouchStart: (event) => {
      if (!enabled || event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      origin.current = { x: touch.clientX, y: touch.clientY };
      fired.current = false;

      timer.current = setTimeout(() => {
        const at = origin.current;
        if (!at) return;
        fired.current = true;
        timer.current = null;
        // 手応えを返せる端末では短く震わせる。返せない端末では何も起きない。
        try {
          navigator.vibrate?.(8);
        } catch {
          // 対応していなければそれでよい。
        }
        onLongPress(at.x, at.y);
      }, LONG_PRESS_MS);
    },

    onTouchMove: (event) => {
      const at = origin.current;
      if (!at || !timer.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      const moved =
        Math.abs(touch.clientX - at.x) > MOVE_TOLERANCE_PX ||
        Math.abs(touch.clientY - at.y) > MOVE_TOLERANCE_PX;
      if (moved) cancel();
    },

    onTouchEnd: cancel,
    onTouchCancel: cancel,

    onClickCapture: (event) => {
      if (!fired.current) return;
      // 長押しで品書きを出した直後の押下は、なかったことにする。
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/* ------------------------------------------------------------------ *
 * 下へ払って閉じる
 * ------------------------------------------------------------------ */

interface DismissOptions {
  /** これ以上下げたら閉じる。 */
  thresholdPx?: number;
  /** これより速く払ったら、距離が足りなくても閉じる (px/ms)。 */
  velocity?: number;
  /** 覆いの濃さも一緒に薄める場合に渡す。 */
  backdrop?: React.RefObject<HTMLElement | null>;
}

/**
 * 下へ払うと閉じる。
 *
 * 指の動きにそのまま付いてくることが大事で、
 * 途中でやめれば元の位置へ戻る。閉じるかどうかは、
 * どこまで下げたかと、どれだけ速く払ったかの両方で決める。
 */
export function useSwipeToDismiss(
  onDismiss: () => void,
  options: DismissOptions = {},
) {
  const { thresholdPx = 120, velocity = 0.5, backdrop } = options;
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; at: number } | null>(null);
  const offset = useRef(0);
  /** 中身を上下に動かしている最中は、払う操作として扱わない。 */
  const scrolling = useRef(false);

  const paint = useCallback(
    (y: number, animate: boolean) => {
      const el = ref.current;
      if (!el) return;
      el.style.transition = animate ? "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)" : "";
      el.style.transform = y === 0 ? "" : `translateY(${y}px)`;
      if (backdrop?.current) {
        backdrop.current.style.transition = animate ? "opacity 0.22s ease-out" : "";
        // 下げるほど背後が透ける。どこへ戻るのかが見える。
        backdrop.current.style.opacity = String(Math.max(0, 1 - y / (thresholdPx * 2.5)));
      }
    },
    [backdrop, thresholdPx],
  );

  return {
    ref,
    bind: {
      onTouchStart: (event: React.TouchEvent) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0]!;
        /*
         * 中身が上下に動かせる位置にあるときは、そちらを優先する。
         * いちばん上まで戻っているときだけ、払う操作として受ける。
         */
        const scroller = (event.target as HTMLElement).closest(".scroll-area");
        scrolling.current = Boolean(scroller && scroller.scrollTop > 0);
        start.current = { y: touch.clientY, at: Date.now() };
        offset.current = 0;
      },

      onTouchMove: (event: React.TouchEvent) => {
        const from = start.current;
        if (!from || scrolling.current) return;
        const touch = event.touches[0];
        if (!touch) return;
        const delta = touch.clientY - from.y;
        // 上へは動かさない。行き過ぎた感じが出て落ち着かない。
        if (delta <= 0) {
          offset.current = 0;
          paint(0, false);
          return;
        }
        offset.current = delta;
        paint(delta, false);
      },

      onTouchEnd: () => {
        const from = start.current;
        start.current = null;
        if (!from || scrolling.current) return;

        const elapsed = Math.max(1, Date.now() - from.at);
        const speed = offset.current / elapsed;
        if (offset.current > thresholdPx || speed > velocity) {
          // 閉じると決めたら、いったん画面の外まで送り出してから消す。
          paint(window.innerHeight, true);
          setTimeout(onDismiss, 180);
          return;
        }
        paint(0, true);
        offset.current = 0;
      },

      onTouchCancel: () => {
        start.current = null;
        paint(0, true);
        offset.current = 0;
      },
    },
  };
}

/** 横へ払って取り除くときの匙加減。 */
interface SwipeAwayOptions {
  /** これだけ横へ送ったら取り除く。 */
  thresholdPx?: number;
  /** これより速く払ったら、距離が足りなくても取り除く (px/ms)。 */
  velocity?: number;
}

/**
 * 横へ払うと取り除く。
 *
 * 一覧の中の一行に付ける。指しかない端末には、行に並んだ小さな
 * ばつ印を狙って押すのが難しい場面がある。払う動きなら狙わなくてよい。
 *
 * 縦に送ろうとしただけで消えると恐ろしいので、
 * はじめの数ピクセルで向きを見定め、横だと分かったときだけ受ける。
 * 途中でやめれば元の場所へ戻る。
 */
export function useSwipeAway(onRemove: () => void, options: SwipeAwayOptions = {}) {
  const { thresholdPx = 96, velocity = 0.4 } = options;
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const offset = useRef(0);
  /** 横に払う操作だと見定めたか。まだ分からない間は null。 */
  const horizontal = useRef<boolean | null>(null);

  const paint = useCallback((x: number, animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.2s" : "";
    el.style.transform = x === 0 ? "" : `translateX(${x}px)`;
    // 送るほど薄れる。離せば消えることが、離す前に分かる。
    el.style.opacity = x === 0 ? "" : String(Math.max(0.15, 1 - Math.abs(x) / (thresholdPx * 2)));
  }, [thresholdPx]);

  return {
    ref,
    bind: {
      onTouchStart: (event: React.TouchEvent) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0]!;
        start.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
        offset.current = 0;
        horizontal.current = null;
      },

      onTouchMove: (event: React.TouchEvent) => {
        const from = start.current;
        if (!from) return;
        const touch = event.touches[0];
        if (!touch) return;

        const dx = touch.clientX - from.x;
        const dy = touch.clientY - from.y;

        /*
         * 向きを見定める。
         *
         * 縦のほうが勝っていれば、一覧を送ろうとしている。
         * その場合はこの先いっさい受けない。指を離すまで判定は変えない。
         */
        if (horizontal.current === null) {
          if (Math.abs(dx) < MOVE_TOLERANCE_PX && Math.abs(dy) < MOVE_TOLERANCE_PX) return;
          horizontal.current = Math.abs(dx) > Math.abs(dy);
        }
        if (!horizontal.current) return;

        offset.current = dx;
        paint(dx, false);
      },

      onTouchEnd: () => {
        const from = start.current;
        start.current = null;
        if (!from || !horizontal.current) {
          horizontal.current = null;
          return;
        }
        horizontal.current = null;

        const elapsed = Math.max(1, Date.now() - from.at);
        const distance = Math.abs(offset.current);
        const speed = distance / elapsed;

        if (distance > thresholdPx || speed > velocity) {
          // 取り除くと決めたら、払った向きへ送り出してから消す。
          paint(offset.current > 0 ? window.innerWidth : -window.innerWidth, true);
          setTimeout(onRemove, 160);
          return;
        }
        paint(0, true);
        offset.current = 0;
      },

      onTouchCancel: () => {
        start.current = null;
        horizontal.current = null;
        paint(0, true);
        offset.current = 0;
      },
    },
  };
}
