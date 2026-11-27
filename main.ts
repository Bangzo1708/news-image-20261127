// news-image-20261127 — entrypoint.
//
// Copies the pre-rendered front page (entry.png, a JPEG image) into the
// output directory after validating it against the competition gate:
// whole PNG or JPEG, at most 1 MiB, at most 1024x1024 pixels.
// Runs with Node 22, standard library only, no network. Deterministic:
// the same bytes go in and out on every run.

import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1048576;
const MAX_DIMENSION = 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function fail(message: string): never {
  throw new Error(`entry validation failed: ${message}`);
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  // PNG: 8-byte signature, then IHDR chunk (length 4 + "IHDR" 4 + width 4 + height 4).
  if (bytes.length < 24) fail("PNG file too short for an IHDR chunk");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height };
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  // JPEG: scan segments for a Start Of Frame marker (0xC0-0xCF except
  // 0xC4 DHT, 0xC8 JPG, 0xCC DAC, which carry no frame size).
  // Segment layout: 0xFF marker, 2-byte big-endian length (length bytes
  // included). SOF data: 1 byte precision, 2 bytes height, 2 bytes width.
  let offset = 2; // skip the SOI marker (FF D8)
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) fail("malformed JPEG segment");
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2; // standalone marker, no length field
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) {
      fail("malformed JPEG segment length");
    }
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (length < 7) fail("JPEG SOF segment too short");
      const height = bytes.readUInt16BE(offset + 5);
      const width = bytes.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + length;
  }
  fail("no JPEG Start Of Frame segment found");
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, "entry.png");
  const bytes = readFileSync(source);

  if (bytes.length === 0) fail("entry.png is empty");
  if (bytes.length > MAX_BYTES) {
    fail(`entry.png is ${bytes.length} bytes, over the 1 MiB limit`);
  }

  let dimensions: { width: number; height: number };
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    dimensions = pngDimensions(bytes);
  } else if (bytes.subarray(0, 3).equals(JPEG_MAGIC)) {
    // JPEG: dimensions are read from the frame header; see jpegDimensions.
    dimensions = jpegDimensions(bytes);
  } else {
    fail("entry.png is neither a PNG nor a JPEG (bad magic bytes)");
  }

  if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
    fail(
      `image is ${dimensions.width}x${dimensions.height}, over the 1024x1024 limit`,
    );
  }
  if (dimensions.width === 0 || dimensions.height === 0) {
    fail("image has a zero dimension");
  }

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  copyFileSync(source, join(outDir, "entry.png"));

  const written = statSync(join(outDir, "entry.png"));
  if (written.size !== bytes.length) fail("written file size differs from source");
}

main();
