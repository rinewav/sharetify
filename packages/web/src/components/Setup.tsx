import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  Laptop,
  Loader2,
  Music,
  Share,
  Smartphone,
  SquarePlus,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import type { NodeHealth } from "@sharetify/shared";
import { PairQr } from "./PairQr.js";
import { useInstallState } from "../lib/install.js";
import { useLibrary } from "../lib/library-store.js";
import { nodePairingStatus, type PairingStatus } from "../lib/node-client.js";
import { isDesktopApp } from "../lib/platform.js";

/**
 * 最初に一度だけ通る道。
 *
 * この仕組みは、曲を探して取ってくるのが「自分の PC」で、
 * スマホはその画面という形をしている。そこを知らないまま使い始めると、
 * 「検索しても何も出ない」ことの理由が分からない。
 * 名前を決める前に、何がどこで動くのかを一度だけ伝えておく。
 */

const DONE_KEY = "sharetify.setup-done";

export function setupDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // 覚えられなくても使えなくはならない。次に開くとまた出るだけ。
  }
}

interface Props {
  health: NodeHealth | null;
  onClose: () => void;
  onOpenPairing: () => void;
}

export function Setup({ health, onClose, onOpenPairing }: Props) {
  const desktop = isDesktopApp();
  const steps = desktop ? DESKTOP_STEPS : WEB_STEPS;
  const [at, setAt] = useState(0);

  const finish = () => {
    markDone();
    onClose();
  };

  const step = steps[at]!;
  const last = at === steps.length - 1;

  return (
    <div className="animate-fade fixed inset-0 z-40 flex flex-col bg-base">
      <div className="scroll-area flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <Content step={step} health={health} onOpenPairing={onOpenPairing} />
        </div>
      </div>

      <footer className="pad-bottom-safe shrink-0 border-t border-line px-6 pt-4">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-4">
          {/* いま何番目かが分かると、あと何回かが読める。 */}
          <div className="flex gap-1.5">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1 rounded-full transition-all ${
                  i === at ? "w-6 bg-accent" : i < at ? "w-1.5 bg-accent/40" : "w-1.5 bg-surface-3"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!last && (
              <button
                type="button"
                onClick={finish}
                className="press rounded-full px-4 py-2.5 text-sm text-ink-muted transition hover:text-ink"
              >
                とばす
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? finish() : setAt(at + 1))}
              className="press flex items-center gap-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-ink transition hover:brightness-110"
            >
              {last ? "はじめる" : "次へ"}
              {!last && <ArrowRight className="size-4" />}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------ 中身 ------------------------------ */

interface Step {
  id: string;
  kind: "welcome" | "how" | "install" | "connect" | "host" | "name";
}

/** 配って回す入れ物の側。ここが迎える側になる。 */
const DESKTOP_STEPS: Step[] = [
  { id: "welcome", kind: "welcome" },
  { id: "how", kind: "how" },
  { id: "host", kind: "host" },
  { id: "name", kind: "name" },
];

/** スマホや閲覧環境の側。つなぐ相手が要る。 */
const WEB_STEPS: Step[] = [
  { id: "welcome", kind: "welcome" },
  { id: "how", kind: "how" },
  { id: "install", kind: "install" },
  { id: "connect", kind: "connect" },
  { id: "name", kind: "name" },
];

function Content({
  step,
  health,
  onOpenPairing,
}: {
  step: Step;
  health: NodeHealth | null;
  onOpenPairing: () => void;
}) {
  switch (step.kind) {
    case "welcome":
      return <Welcome />;
    case "how":
      return <HowItWorks />;
    case "install":
      return <InstallStep />;
    case "connect":
      return <ConnectStep health={health} onOpenPairing={onOpenPairing} />;
    case "host":
      return <HostStep health={health} />;
    case "name":
      return <NameStep />;
  }
}

function Welcome() {
  return (
    <div className="animate-rise text-center">
      <img src="/icons/icon-192.png" alt="" className="mx-auto size-24 rounded-2xl shadow-2xl" />
      <h1 className="mt-6 text-3xl font-black tracking-tight">Sharetify へようこそ</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        友だちとプレイリストを共有して、離れていても同じ曲を同じ場所で聴けます。
      </p>
    </div>
  );
}

/**
 * どこで何が動くのか。
 *
 * ここを飛ばすと、あとで「繋がっていません」の意味が分からなくなる。
 */
function HowItWorks() {
  return (
    <div className="animate-rise">
      <h1 className="text-2xl font-bold tracking-tight">仕組みはかんたん</h1>
      <p className="mt-2 text-sm text-ink-muted">曲を探して取ってくるのは、あなたの PC です。</p>

      <div className="mt-6 space-y-3">
        <Row
          icon={<Laptop className="size-5" />}
          title="あなたの PC"
          body="曲を探し、取ってきて、手元に残します。ここが本体です。"
        />
        <Row
          icon={<Smartphone className="size-5" />}
          title="スマホ"
          body="PC につないで、その画面として使います。音は PC から直接届きます。"
        />
        <Row
          icon={<Music className="size-5" />}
          title="中央のサーバー"
          body="名前・グループ・並び・再生位置だけを預かります。曲そのものは通りません。"
          muted
        />
      </div>
    </div>
  );
}

/** ホーム画面に置いてもらう。iOS は自分で操作してもらうしかない。 */
function InstallStep() {
  const install = useInstallState();
  const [result, setResult] = useState<string | null>(null);

  if (install.installed) {
    return (
      <div className="animate-rise">
        <Badge ok>ホーム画面から開いています</Badge>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">準備できています</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          この形なら、画面を消しても音が続きます。
        </p>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-2xl font-bold tracking-tight">ホーム画面に置く</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        閲覧環境の中で開いたままだと、画面を消したときに音が止まることがあります。
        ホーム画面から開けば、そこが解消します。
      </p>

      {install.needsManualSteps ? (
        // iOS はこちらから出せないので、道順を示す。
        <div className="mt-5 space-y-2.5 rounded-lg bg-surface p-4">
          <Manual n={1} icon={<Share className="size-4" />} text="下の共有ボタンを押す" />
          <Manual n={2} icon={<SquarePlus className="size-4" />} text="「ホーム画面に追加」を選ぶ" />
          <Manual n={3} icon={<Check className="size-4" />} text="右上の「追加」を押す" />
        </div>
      ) : install.canPrompt ? (
        <button
          type="button"
          onClick={() =>
            void install.promptInstall().then((r) =>
              setResult(r === "accepted" ? "入れました" : r === "dismissed" ? "またあとで" : null),
            )
          }
          className="press mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-surface-3 py-3 text-sm font-medium transition hover:bg-line"
        >
          <Download className="size-4" />
          ホーム画面に追加
        </button>
      ) : (
        <p className="mt-5 rounded-lg bg-surface p-4 text-xs leading-relaxed text-ink-faint">
          お使いの環境では、閲覧環境の設定から追加できます。
          あとから設定し直すこともできます。
        </p>
      )}

      {result && <p className="mt-3 text-center text-xs text-accent">{result}</p>}
    </div>
  );
}

/** つないでいないと何もできないことを、はっきり伝える。 */
function ConnectStep({
  health,
  onOpenPairing,
}: {
  health: NodeHealth | null;
  onOpenPairing: () => void;
}) {
  const online = health?.ok === true;

  return (
    <div className="animate-rise">
      {online ? (
        <Badge ok>つながっています</Badge>
      ) : (
        <Badge>まだつながっていません</Badge>
      )}

      <h1 className="mt-4 text-2xl font-bold tracking-tight">自分の PC につなぐ</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        {online
          ? "曲を探して聴けます。この先はふつうに使えます。"
          : "つなぐまでは、曲を探すことも新しく聴くこともできません。"}
      </p>

      {!online && (
        <>
          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              つないでいない間にできるのは、
              端末に残した曲を鳴らすことだけです。
            </span>
          </div>

          <div className="mt-5 space-y-2.5 rounded-lg bg-surface p-4">
            <Manual n={1} icon={<Laptop className="size-4" />} text="PC で Sharetify を開く" />
            <Manual n={2} icon={<Copy className="size-4" />} text="出ている 6 文字の合言葉を確かめる" />
            <Manual n={3} icon={<Wifi className="size-4" />} text="下のボタンから、その合言葉を入れる" />
          </div>

          <button
            type="button"
            onClick={onOpenPairing}
            className="press mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-sm font-semibold text-accent-ink transition hover:brightness-110"
          >
            <Wifi className="size-4" />
            合言葉を入れる
          </button>
        </>
      )}
    </div>
  );
}

/** 迎える側であることを伝え、渡すものを見せる。 */
function HostStep({ health }: { health: NodeHealth | null }) {
  const [pairing, setPairing] = useState<PairingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      nodePairingStatus()
        .then((s) => !cancelled && setPairing(s))
        .catch(() => undefined);
    void check();
    const timer = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const ready = health?.resolverReady === true;

  return (
    <div className="animate-rise">
      <Badge ok>この PC で動いています</Badge>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">ここが本体です</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        曲を探して取ってくるのはこの PC。スマホからは、下の合言葉でつなぎます。
      </p>

      <div className="mt-5 flex items-center gap-4 rounded-lg bg-surface p-4">
        {pairing?.code ? (
          <PairQr code={pairing.code} size={128} />
        ) : (
          <div className="size-32 animate-pulse rounded-xl bg-surface-3" />
        )}
        <div className="min-w-0">
          <div className="text-xs font-semibold text-ink-faint">スマホのカメラを向ける</div>
          <div className="mt-2 font-mono text-2xl tracking-[0.2em]">
            {pairing?.code ?? "······"}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            読み取れないときは、この合言葉を打ち込んでも繋がります。
          </p>
        </div>
      </div>

      {!ready && (
        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {health?.resolverMessage ??
              "曲を取ってくる仕掛けがまだ整っていません。整うまで、新しい曲は鳴らせません。"}
          </span>
        </div>
      )}
    </div>
  );
}

/** 最後に名前。共有には名前が要る。 */
function NameStep() {
  const { user, signIn, loading, error } = useLibrary();
  const [name, setName] = useState("");

  if (user) {
    return (
      <div className="animate-rise text-center">
        <Badge ok>{user.displayName} として使います</Badge>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">準備できました</h1>
        <p className="mt-2 text-sm text-ink-muted">さっそく一曲さがしてみてください。</p>
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <h1 className="text-2xl font-bold tracking-tight">名前を決める</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        友だちと共有するときに表示されます。あとから変えられます。
      </p>

      <input
        value={name}
        onChange={(event) => setName(event.target.value.slice(0, 24))}
        onKeyDown={(event) => event.key === "Enter" && name.trim() && void signIn(name.trim())}
        placeholder="りね"
        autoCapitalize="off"
        className="mt-5 w-full rounded-lg bg-surface-3 px-4 py-3 text-base outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/40"
      />

      {error && <p className="mt-3 text-xs text-amber-300">{error}</p>}

      <button
        type="button"
        onClick={() => void signIn(name.trim())}
        disabled={loading || name.trim().length === 0}
        className="press mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-surface-3 py-3 text-sm font-medium transition hover:bg-line disabled:opacity-40"
      >
        {loading && <Loader2 className="size-4 animate-spin" />}
        この名前にする
      </button>
    </div>
  );
}

/* ------------------------------ 部品 ------------------------------ */

function Row({
  icon,
  title,
  body,
  muted = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface p-3.5">
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-full ${
          muted ? "bg-surface-3 text-ink-muted" : "bg-accent/15 text-accent"
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{body}</div>
      </div>
    </div>
  );
}

function Manual({ n, icon, text }: { n: number; icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-ink-muted">
        {n}
      </span>
      <span className="shrink-0 text-ink-muted">{icon}</span>
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function Badge({ children, ok = false }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-accent/15 text-accent" : "bg-amber-500/15 text-amber-300"
      }`}
    >
      <span className={`size-1.5 rounded-full ${ok ? "bg-accent" : "bg-amber-400"}`} />
      {children}
    </span>
  );
}
