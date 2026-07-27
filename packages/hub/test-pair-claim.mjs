/**
 * 合言葉を名乗り直せるのが、前と同じ相手だけかどうかの確認。
 *
 * 覚えているだけだと、別の機械が先に名乗って横取りできてしまう。
 * 印を照らし合わせて、同じ相手のときだけ通すこと。
 */

const HUB = "ws://127.0.0.1:47820/pair?role=host";
const results = [];
const pass = (id, note) => results.push({ ok: true, id, note });
const fail = (id, note) => results.push({ ok: false, id, note });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 名乗り出て、渡された合言葉を受け取る。 */
function register(previousCode, identity) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("返ってこない"));
    }, 5000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "host:register",
          ...(previousCode ? { previousCode } : {}),
          ...(identity ? { identity } : {}),
          label: "検証",
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.type !== "host:registered") return;
      clearTimeout(timer);
      resolve({ code: msg.code, close: () => ws.close() });
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("つながらない"));
    });
  });
}

const meA = "identity-aaa-1111";
const meB = "identity-bbb-2222";

// --- はじめて名乗る ---
const first = await register(undefined, meA);
const code = first.code;
pass("はじめての名乗り", `合言葉 ${code}`);
first.close();
await sleep(400);

// --- 同じ相手が名乗り直す ---
const again = await register(code, meA);
again.code === code
  ? pass("同じ相手は名乗り直せる", `${code} のまま`)
  : fail("同じ相手は名乗り直せる", `${code} → ${again.code}`);
again.close();
await sleep(400);

// --- 別の相手が同じ合言葉を名乗る ---
const other = await register(code, meB);
other.code !== code
  ? pass("別の相手は横取りできない", `${code} を求めたが ${other.code} になった`)
  : fail("別の相手は横取りできない", "横取りできてしまった");
other.close();
await sleep(400);

// --- 印を持たない相手が名乗る ---
const anonymous = await register(code, undefined);
anonymous.code !== code
  ? pass("印の無い相手も横取りできない", `${anonymous.code} になった`)
  : fail("印の無い相手も横取りできない", "横取りできてしまった");
anonymous.close();
await sleep(400);

// --- 元の相手は、そのあとも名乗り直せる ---
const back = await register(code, meA);
back.code === code
  ? pass("元の相手はそのあとも名乗れる", `${code} のまま`)
  : fail("元の相手はそのあとも名乗れる", `${code} → ${back.code}`);
back.close();

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id.padEnd(24)} ${r.note}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad}/${results.length} 通過`);
process.exit(bad ? 1 : 0);
