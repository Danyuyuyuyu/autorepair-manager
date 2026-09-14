/**
 * PWA 图标生成器
 * ---------------------------------------------------------------------------
 * 不依赖任何第三方图像库：
 *   - 用有符号距离场（SDF）+ 3x 超采样绘制矢量图形（抗锯齿）
 *   - 用 node:zlib 直接编码 PNG（IHDR / IDAT / IEND + CRC32）
 *
 * 图形：品牌色圆角方块 + 白色方向盘（外圈 + 轮毂 + 三根辐条）
 *   方向盘是汽修行业最强的行业识别符号，且在 48px 下依然清晰。
 *
 * 注意：SDF 使用归一化坐标（0..1），抗锯齿过渡宽度必须换算为
 *       「一个像素对应的归一化长度」（1/size），否则整幅图会被羽化。
 *
 * 用法：node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../public/icons");

const BRAND = [37, 99, 235]; // #2563eb
const WHITE = [255, 255, 255];

// ---------------------------------------------------------------------------
// 基础数学
// ---------------------------------------------------------------------------

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** SDF -> 覆盖率；aa 为过渡带宽度（归一化单位） */
const coverage = (d, aa) => clamp(0.5 - d / aa, 0, 1);

/** 圆角矩形 SDF */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

/** 胶囊（线段加粗）SDF */
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay || 1;
  const h = clamp((pax * bax + pay * bay) / denom, 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

const union = (...d) => Math.min(...d);

// ---------------------------------------------------------------------------
// 图形定义（归一化 0..1 坐标系）
// ---------------------------------------------------------------------------

/** 主图标：圆角方块背景 + 白色方向盘 */
function sampleIcon(u, v, { maskable = false, aa = 0.002 } = {}) {
  // maskable 版本需要留安全区，图形整体缩小
  const scale = maskable ? 1.34 : 1;
  const cu = (u - 0.5) * scale + 0.5;
  const cv = (v - 0.5) * scale + 0.5;

  // 背景圆角方块（maskable 铺满整格，由系统裁剪成圆形/方形）
  const bgAlpha = maskable ? 1 : coverage(sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.225), aa);

  // ---- 方向盘 ----
  const R = 0.315; // 外圈半径
  const ringWidth = 0.072; // 外圈粗细
  const outerRing = Math.abs(sdCircle(cu, cv, 0.5, 0.5, R)) - ringWidth / 2;

  const hub = sdCircle(cu, cv, 0.5, 0.5, 0.082); // 中央轮毂

  // 三根辐条：上、左下、右下
  const spokeR = 0.036;
  const inner = R - ringWidth * 0.75;
  const spokes = Math.min(
    sdCapsule(cu, cv, 0.5, 0.5, 0.5, 0.5 - inner, spokeR),
    sdCapsule(cu, cv, 0.5, 0.5, 0.5 - inner * 0.866, 0.5 + inner * 0.5, spokeR),
    sdCapsule(cu, cv, 0.5, 0.5, 0.5 + inner * 0.866, 0.5 + inner * 0.5, spokeR),
  );

  const wheelAlpha = coverage(union(outerRing, hub, spokes), aa);

  // 合成：品牌色 -> 白色
  const r = lerp(BRAND[0], WHITE[0], wheelAlpha);
  const g = lerp(BRAND[1], WHITE[1], wheelAlpha);
  const b = lerp(BRAND[2], WHITE[2], wheelAlpha);

  return [r, g, b, bgAlpha * 255];
}

// ---------------------------------------------------------------------------
// 光栅化
// ---------------------------------------------------------------------------

function rasterize(size, options) {
  const SS = 4; // 超采样倍数
  const aa = 1 / size;
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const [pr, pg, pb, pa] = sampleIcon(u, v, { ...options, aa });
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }

      const samples = SS * SS;
      const alpha = a / samples;
      const offset = (y * size + x) * 4;

      if (alpha <= 0.0001) {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
      } else {
        // 反预乘还原颜色；再做量化以提升 PNG 压缩率
        // （平色图标不需要 256 级 alpha，32 级足够，体积可降一个数量级）
        const quantize = (value, step) => Math.round(value / step) * step;
        pixels[offset] = clamp(quantize(Math.round((r / a) * 255), 4), 0, 255);
        pixels[offset + 1] = clamp(quantize(Math.round((g / a) * 255), 4), 0, 255);
        pixels[offset + 2] = clamp(quantize(Math.round((b / a) * 255), 4), 0, 255);
        pixels[offset + 3] = clamp(quantize(Math.round(alpha), 8), 0, 255);
      }
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// PNG 编码
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// SVG 版本（现代浏览器优先使用，体积更小、无限清晰）
// ---------------------------------------------------------------------------

function buildSvg() {
  const R = 31.5;
  const ring = 7.2;
  const inner = R - ring * 0.75;
  const spokes = [
    `M50 50 L50 ${(50 - inner).toFixed(2)}`,
    `M50 50 L${(50 - inner * 0.866).toFixed(2)} ${(50 + inner * 0.5).toFixed(2)}`,
    `M50 50 L${(50 + inner * 0.866).toFixed(2)} ${(50 + inner * 0.5).toFixed(2)}`,
  ].join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="汽修管家">
  <rect width="100" height="100" rx="22.5" fill="#2563eb"/>
  <g fill="none" stroke="#ffffff" stroke-width="${ring}" stroke-linecap="round">
    <circle cx="50" cy="50" r="${R - ring / 2}"/>
    <path d="${spokes}" stroke-width="7.2"/>
  </g>
  <circle cx="50" cy="50" r="8.2" fill="#ffffff"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, options: {} },
  { file: "icon-512.png", size: 512, options: {} },
  { file: "icon-maskable-512.png", size: 512, options: { maskable: true } },
  { file: "apple-touch-icon.png", size: 180, options: {} },
  { file: "favicon-32.png", size: 32, options: {} },
];

for (const target of targets) {
  const pixels = rasterize(target.size, target.options);
  const png = encodePng(pixels, target.size);
  writeFileSync(resolve(OUT_DIR, target.file), png);
  console.log(`generated ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
}

writeFileSync(resolve(OUT_DIR, "icon.svg"), buildSvg(), "utf8");
console.log("generated icon.svg");
console.log(`\n图标已输出到 ${OUT_DIR}`);
