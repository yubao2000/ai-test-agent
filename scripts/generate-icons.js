// 生成 Chrome 扩展图标占位文件（纯色方块）
const fs = require("fs");
const path = require("path");

// 最小 PNG 编码函数（单色方块）
function createPNG(size, r, g, b) {
  // 手动构造一个最小 PNG: 单色方块
  // PNG 文件结构: signature + IHDR + IDAT + IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); // PNG signature

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);  // width
  ihdrData.writeUInt32BE(size, 4);  // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type (RGB)
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = chunk("IHDR", ihdrData);

  // IDAT chunk - raw pixel data with filter byte
  const rawRow = Buffer.alloc(1 + size * 3); // filter byte + RGB pixels
  rawRow[0] = 0; // filter: None
  for (let x = 0; x < size; x++) {
    rawRow[1 + x * 3] = r;
    rawRow[2 + x * 3] = g;
    rawRow[3 + x * 3] = b;
  }

  // Repeat for all rows
  const rawData = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 3)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const off = y * (1 + size * 3) + 1 + x * 3;
      rawData[off] = r;
      rawData[off + 1] = g;
      rawData[off + 2] = b;
    }
  }

  // 用 zlib 压缩
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(rawData);
  const idat = chunk("IDAT", compressed);

  // IEND
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0xedb88320;
      else crc >>>= 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const outDir = path.resolve(__dirname, "..", "extension", "icons");
[16, 48, 128].forEach((size) => {
  // 蓝紫色渐变效果单色（用中间色）
  const png = createPNG(size, 59, 130, 246); // #3B82F6 blue
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`  ✅ icon${size}.png (${png.length} bytes)`);
});
