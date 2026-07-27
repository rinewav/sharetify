/**
 * ずれの詰め方の検証。
 *
 * 毎秒跳ばすと音が途切れ、途切れた分また遅れて、次の秒でまた跳ぶ、
 * という堂々巡りになる (実測で -400ms と -260ms を往復し続けた)。
 * 小さいずれは送りの速さで詰め、大きいときだけ跳ぶ、という形になっているか確かめる。
 */

const SYNC_DRIFT_NUDGE_MS = 40;
const SYNC_DRIFT_SEEK_MS = 400;
const MAX_RATE_SHIFT = 0.04;

/** session-store の reconcile と同じ判断をここで再現する。 */
function decide(drift) {
  if (Math.abs(drift) >= SYNC_DRIFT_SEEK_MS) return { action: "跳ぶ", rate: 1 };
  if (Math.abs(drift) < SYNC_DRIFT_NUDGE_MS) return { action: "そのまま", rate: 1 };
  const shift = Math.min(MAX_RATE_SHIFT, (Math.abs(drift) / SYNC_DRIFT_SEEK_MS) * MAX_RATE_SHIFT);
  return { action: "速さで詰める", rate: drift > 0 ? 1 - shift : 1 + shift };
}

const results = [];
const check = (label, ok, detail) => results.push({ ok, label, detail });

// --- 判断の境目 ---
for (const [drift, wantAction] of [
  [0, "そのまま"], [39, "そのまま"], [-39, "そのまま"],
  [40, "速さで詰める"], [-40, "速さで詰める"],
  [200, "速さで詰める"], [-200, "速さで詰める"],
  [399, "速さで詰める"], [-399, "速さで詰める"],
  [400, "跳ぶ"], [-400, "跳ぶ"], [5000, "跳ぶ"],
]) {
  const got = decide(drift);
  check(`ずれ ${drift}ms → ${wantAction}`, got.action === wantAction, got.action);
}

// --- 進んでいるときは遅く、遅れているときは速く ---
check("進んでいる(+200)なら遅くする", decide(200).rate < 1, decide(200).rate.toFixed(4));
check("遅れている(-200)なら速くする", decide(-200).rate > 1, decide(-200).rate.toFixed(4));

// --- 変える幅は上限を超えない ---
const rates = [40, 100, 200, 300, 399].map((d) => decide(-d).rate);
check(
  "速さの振れ幅は 4% を超えない",
  rates.every((r) => r <= 1 + MAX_RATE_SHIFT + 1e-9),
  rates.map((r) => r.toFixed(3)).join(", "),
);

// --- 実際に収束するか。1 秒ごとに詰めていく様子を追う ---
function simulate(startDrift, seconds = 30) {
  let drift = startDrift;
  const trace = [];
  for (let t = 0; t < seconds; t++) {
    const { action, rate } = decide(drift);
    if (action === "跳ぶ") {
      drift = 0;
    } else {
      // 1 秒間 rate で送ると、(rate - 1) * 1000ms ぶん余計に進む。
      // 遅れている (drift < 0) ときは速くするので、drift は 0 に近づく。
      drift += (rate - 1) * 1000;
    }
    trace.push(Math.round(drift));
  }
  return trace;
}

const fromBehind = simulate(-380);
check(
  "遅れ 380ms から収まる",
  Math.abs(fromBehind.at(-1)) < SYNC_DRIFT_NUDGE_MS,
  `${fromBehind.slice(0, 12).join(" → ")} … 最後 ${fromBehind.at(-1)}`,
);

const fromAhead = simulate(350);
check(
  "進み 350ms から収まる",
  Math.abs(fromAhead.at(-1)) < SYNC_DRIFT_NUDGE_MS,
  `${fromAhead.slice(0, 12).join(" → ")} … 最後 ${fromAhead.at(-1)}`,
);

// --- 振動しないこと (以前の実装との比較) ---
function simulateOld(startDrift, seconds = 30) {
  let drift = startDrift;
  const trace = [];
  for (let t = 0; t < seconds; t++) {
    if (Math.abs(drift) >= SYNC_DRIFT_SEEK_MS) drift = 0;
    else if (Math.abs(drift) >= SYNC_DRIFT_NUDGE_MS) {
      // 差の半分を跳んで詰めるが、跳んだせいで再生が途切れ、
      // その間に 120ms ほど遅れ直す (実測に合わせた値)。
      drift = drift / 2 - 120;
    }
    trace.push(Math.round(drift));
  }
  return trace;
}
const old = simulateOld(-380);
const oldSettled = Math.abs(old.at(-1)) < SYNC_DRIFT_NUDGE_MS;
check(
  "以前の詰め方では収まらなかった (比較)",
  !oldSettled,
  `${old.slice(0, 8).join(" → ")} … 最後 ${old.at(-1)}`,
);

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.label.padEnd(34)} ${r.detail}`);
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 通過`);
process.exit(bad ? 1 : 0);
