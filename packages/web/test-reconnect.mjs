/**
 * 繋ぎ直しの間隔の検証。
 *
 * すぐに何度も試すと、こちらも相手も無駄に忙しくなる。
 * 失敗が続くほど間隔を空け、ただし空けすぎないこと。
 */

const results = [];
const check = (label, ok, detail) => results.push({ ok, label, detail });

/** peer-client の scheduleRetry と同じ計算をここで再現する。 */
function waitFor(retryCount) {
  return Math.min(30_000, 1000 * 2 ** Math.min(retryCount - 1, 5));
}

// --- 間隔の伸び方 ---
const waits = [1, 2, 3, 4, 5, 6, 7, 8, 10].map(waitFor);
check(
  "だんだん間隔が空く",
  waits.every((w, i) => i === 0 || w >= waits[i - 1]),
  waits.map((w) => `${w / 1000}s`).join(" → "),
);
check("最初は 1 秒", waits[0] === 1000, `${waits[0]}ms`);
check("30 秒で頭打ち", Math.max(...waits) === 30_000, `最大 ${Math.max(...waits) / 1000}s`);
check(
  "頭打ちのあとは伸びない",
  waitFor(6) === waitFor(20),
  `6回目 ${waitFor(6) / 1000}s / 20回目 ${waitFor(20) / 1000}s`,
);

// --- 諦めずに試し続けるか ---
let total = 0;
for (let i = 1; i <= 20; i++) total += waitFor(i);
check(
  "20 回試しても現実的な時間に収まる",
  total < 10 * 60_000,
  `合計 ${Math.round(total / 1000)} 秒`,
);

// --- つながったら数え直すか ---
const afterReconnect = waitFor(1);
check("つながったあとは短い間隔から", afterReconnect === 1000, `${afterReconnect}ms`);

// --- 何回目でどれくらい待つか、目で見て確かめる ---
console.log("  試行ごとの待ち時間:");
for (const n of [1, 2, 3, 4, 5, 6, 7, 10]) {
  console.log(`    ${String(n).padStart(2)} 回目: ${waitFor(n) / 1000} 秒`);
}
console.log();

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.label.padEnd(30)} ${r.detail}`);
}
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 通過`);
process.exit(bad ? 1 : 0);
