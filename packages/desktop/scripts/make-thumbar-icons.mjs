import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Windows のタスクバーに出す小さなボタンの絵を作る。
 *
 * 外から絵を持ってくると、配るものの中に出どころの分からない画像が増える。
 * 形は三角と四角しかないので、ここで描いてしまうほうが早い。
 *
 * 明るい配色と暗い配色の両方を作る。タスクバーの背景は設定で入れ替わり、
 * 白い絵だけを持たせると、明るい配色のときに何も見えなくなる。
 *
 * 使い方: node scripts/make-thumbar-icons.mjs
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "build", "thumbar");

/** 出来上がりの一辺。Windows がこの並びに求める大きさ。 */
const SIZE = 16;
/** 一画素を何回に分けて見るか。境目のギザギザを均すために増やす。 */
const SAMPLES = 4;

/* ------------------------------ 形 ------------------------------ */

/*
 * 0〜1 の升目で形を決める。大きさに依らないので、
 * あとから別の寸法が要るようになっても書き直さずに済む。
 */

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** 三点で囲んだ内側か。符号の向きが揃えば中にいる。 */
const triangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const side = (px, py, qx, qy) => (qx - px) * (y - py) - (qy - py) * (x - px);
  const s1 = side(ax, ay, bx, by);
  const s2 = side(bx, by, cx, cy);
  const s3 = side(cx, cy, ax, ay);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
};

const any = (...shapes) => (x, y) => shapes.some((inside) => inside(x, y));

const GLYPHS = {
  play: triangle(0.3, 0.16, 0.3, 0.84, 0.82, 0.5),
  pause: any(rect(0.28, 0.16, 0.43, 0.84), rect(0.57, 0.16, 0.72, 0.84)),
  prev: any(rect(0.22, 0.16, 0.32, 0.84), triangle(0.82, 0.16, 0.82, 0.84, 0.38, 0.5)),
  next: any(rect(0.68, 0.16, 0.78, 0.84), triangle(0.18, 0.16, 0.18, 0.84, 0.62, 0.5)),
};

/* ------------------------------ 絵にする ------------------------------ */

/** 形を塗り分けて、透明度付きの点の並びにする。 */
function raster(inside, rgb) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);

  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      // 一画素を細かく割って、何割が形に入るかを数える。それが濃さになる。
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / SIZE;
          const y = (py + (sy + 0.5) / SAMPLES) / SIZE;
          if (inside(x, y)) hits += 1;
        }
      }

      const at = (py * SIZE + px) * 4;
      pixels[at] = rgb[0];
      pixels[at + 1] = rgb[1];
      pixels[at + 2] = rgb[2];
      pixels[at + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }

  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 点の並びを PNG に包む。読める形にしないと nativeImage が受け取らない。 */
function png(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // 一色あたりの深さ
  header[9] = 6; // 色 + 透明度
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  // 行ごとに、加工していない印 (0) を頭に足す決まりになっている。
  const rows = [];
  for (let y = 0; y < SIZE; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------ 書き出す ------------------------------ */

mkdirSync(OUT, { recursive: true });

/*
 * 暗い背景には白、明るい背景には黒に近い灰。
 * 真っ黒は縁が硬く見えるので、少しだけ浮かせる。
 */
const TONES = { dark: [255, 255, 255], light: [32, 32, 32] };

for (const [name, inside] of Object.entries(GLYPHS)) {
  for (const [tone, rgb] of Object.entries(TONES)) {
    const file = join(OUT, `${name}-${tone}.png`);
    writeFileSync(file, png(raster(inside, rgb)));
    console.log(`書きました: ${file}`);
  }
}
