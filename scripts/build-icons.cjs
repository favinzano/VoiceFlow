const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const source = path.join(root, "assets", "app-icon.svg");
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function build() {
  const images = await Promise.all(sizes.map((size) => (
    sharp(source).resize(size, size).png().toBuffer()
  )));

  await Promise.all([
    sharp(source).resize(1024, 1024).png().toFile(path.join(root, "assets", "app-icon.png")),
    sharp(source).resize(64, 64).png().toFile(path.join(root, "assets", "app-icon-64.png")),
    sharp(source).resize(32, 32).png().toFile(path.join(root, "assets", "app-icon-32.png"))
  ]);

  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry);
    header.writeUInt8(sizes[index] === 256 ? 0 : sizes[index], entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });

  await fs.writeFile(path.join(root, "assets", "app-icon.ico"), Buffer.concat([header, ...images]));
  console.log("Application icons generated.");
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
