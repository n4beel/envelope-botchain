"use client";

import React, { useMemo } from "react";

/**
 * Compact, self-contained offline QR Code generator.
 * Zero external dependencies. Generates crisp SVG vectors.
 */

// GF(256) tables with primitive polynomial 0x11d
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function rsGeneratorPoly(numEc: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < numEc; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], root);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, numEc: number): Uint8Array {
  const gen = rsGeneratorPoly(numEc);
  const rem = new Uint8Array(numEc);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    for (let j = 0; j < numEc - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[numEc - j], factor);
    }
    rem[numEc - 1] = gfMul(gen[0], factor);
  }
  return rem;
}

// Version table: [version, size, totalDataBytes, ecBytes, alignmentPos]
// Using Level L error correction for maximum capacity in compact size
const VERSION_SPECS = [
  { ver: 1, size: 21, dataBytes: 19, ecBytes: 7, align: [] },
  { ver: 2, size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
  { ver: 3, size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
  { ver: 4, size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
  { ver: 5, size: 37, dataBytes: 108, ecBytes: 26, align: [6, 30] },
  { ver: 6, size: 41, dataBytes: 136, ecBytes: 36, align: [6, 34] },
];

function generateQRMatrix(text: string): boolean[][] | null {
  const utf8 = new TextEncoder().encode(text);
  const spec = VERSION_SPECS.find((s) => utf8.length + 3 <= s.dataBytes);
  if (!spec) return null;

  // 1. Bit buffer encoding: Byte Mode (0100) + Char Count (8 bits for v1-9) + data
  const bits: number[] = [0, 1, 0, 0];
  const charCount = utf8.length;
  for (let i = 7; i >= 0; i--) bits.push((charCount >> i) & 1);
  for (const byte of utf8) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }

  // Terminator (up to 4 bits of 0)
  const maxBits = spec.dataBytes * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);

  // Pad to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes: alternating 0xEC (11101100) and 0x11 (00010001)
  const padPatterns = [
    [1, 1, 1, 0, 1, 1, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 1],
  ];
  let padIdx = 0;
  while (bits.length < maxBits) {
    bits.push(...padPatterns[padIdx]);
    padIdx = 1 - padIdx;
  }

  const dataCodewords = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < spec.dataBytes; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    dataCodewords[i] = byte;
  }

  // 2. Reed-Solomon Error Correction
  const ecCodewords = rsComputeRemainder(dataCodewords, spec.ecBytes);
  const allCodewords = new Uint8Array(spec.dataBytes + spec.ecBytes);
  allCodewords.set(dataCodewords, 0);
  allCodewords.set(ecCodewords, spec.dataBytes);

  // 3. Matrix setup
  const N = spec.size;
  const matrix: (boolean | null)[][] = Array.from({ length: N }, () =>
    Array(N).fill(null)
  );

  // Function to place finder pattern at (r, c)
  const placeFinder = (r: number, c: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const row = r + dr;
        const col = c + dc;
        if (row < 0 || row >= N || col < 0 || col >= N) continue;
        if (
          dr >= 0 &&
          dr <= 6 &&
          dc >= 0 &&
          dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4))
        ) {
          matrix[row][col] = true;
        } else {
          matrix[row][col] = false;
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, N - 7);
  placeFinder(N - 7, 0);

  // Timing patterns
  for (let i = 8; i < N - 8; i++) {
    if (matrix[6][i] === null) matrix[6][i] = i % 2 === 0;
    if (matrix[i][6] === null) matrix[i][6] = i % 2 === 0;
  }

  // Alignment patterns
  if (spec.align.length === 2) {
    const r = spec.align[1];
    const c = spec.align[1];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const row = r + dr;
        const col = c + dc;
        if (matrix[row][col] !== null) continue;
        matrix[row][col] =
          Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
      }
    }
  }

  // Dark module
  matrix[4 * spec.ver + 9][8] = true;

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) matrix[8][i] = false;
    if (matrix[i][8] === null) matrix[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (matrix[8][N - 1 - i] === null) matrix[8][N - 1 - i] = false;
    if (matrix[N - 1 - i][8] === null) matrix[N - 1 - i][8] = false;
  }

  // 4. Place Data Bits in zigzag
  const codewordBits: number[] = [];
  for (const cw of allCodewords) {
    for (let b = 7; b >= 0; b--) codewordBits.push((cw >> b) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = N - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing pattern
    for (let vert = 0; vert < N; vert++) {
      const row = upward ? N - 1 - vert : vert;
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        if (matrix[row][col] === null) {
          const bit = bitIdx < codewordBits.length ? codewordBits[bitIdx++] === 1 : false;
          // Apply standard Mask 0: (row + col) % 2 == 0
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = mask ? !bit : bit;
        }
      }
    }
    upward = !upward;
  }

  // 5. Format info for EC Level L (01) and Mask 0 (000): 15-bit format is 0x77c4
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  const fmtCoords = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = formatBits[i] === 1;
    const [r, c] = fmtCoords[i];
    matrix[r][c] = bit;
  }
  const fmtCoords2 = [
    [N - 1, 8], [N - 2, 8], [N - 3, 8], [N - 4, 8], [N - 5, 8], [N - 6, 8], [N - 7, 8],
    [8, N - 8], [8, N - 7], [8, N - 6], [8, N - 5], [8, N - 4], [8, N - 3], [8, N - 2], [8, N - 1]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = formatBits[i] === 1;
    const [r, c] = fmtCoords2[i];
    matrix[r][c] = bit;
  }

  return matrix as boolean[][];
}

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export default function QRCode({ value, size = 180, className = "" }: QRCodeProps) {
  const matrix = useMemo(() => generateQRMatrix(value), [value]);

  if (!matrix) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center bg-[#F6EFE0] border border-[#A88B55] text-[11px] text-[#4A3A1F] text-center p-2 rounded-sm"
      >
        QR unavailable
      </div>
    );
  }

  const N = matrix.length;
  const padding = 2;
  const total = N + padding * 2;

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      className={`rounded-sm bg-[#F6EFE0] border border-[#A88B55] p-2 ${className}`}
      aria-label="QR Code link to envelope"
      role="img"
    >
      <rect width={total} height={total} fill="#F6EFE0" />
      {matrix.map((row, r) =>
        row.map((cell, c) =>
          cell ? (
            <rect
              key={`${r}-${c}`}
              x={c + padding}
              y={r + padding}
              width={1}
              height={1}
              fill="#2A1D0E"
            />
          ) : null
        )
      )}
    </svg>
  );
}
