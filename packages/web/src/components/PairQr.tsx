import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface Props {
  /** 渡す合言葉。 */
  code: string;
  /** 読み取った先で開く場所。 */
  hubUrl?: string;
  size?: number;
}

/**
 * 合言葉を絵にして渡す。
 *
 * 六文字を読み上げて打ってもらうより、向けてもらうほうが早いし間違えない。
 * 読み取った先では、開くと同時に合言葉が入った状態になる。
 */
export function PairQr({ code, hubUrl = "https://sharetify.rine.bio", size = 176 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const target = `${hubUrl}/?pair=${encodeURIComponent(code)}`;

    void QRCode.toDataURL(target, {
      width: size * 2,
      margin: 1,
      // 暗い画面に置くので、白地に黒で描いて周りだけ丸く抜く。
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        // 描けなくても、六文字を読んで打てば繋がる。
      });

    return () => {
      cancelled = true;
    };
  }, [code, hubUrl, size]);

  if (!dataUrl) {
    return (
      <div
        className="animate-pulse rounded-xl bg-surface-3"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`合言葉 ${code} の QR コード`}
      width={size}
      height={size}
      className="rounded-xl bg-white p-2"
    />
  );
}
