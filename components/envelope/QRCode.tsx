"use client";

import { useMemo } from "react";
import qrcode from "qrcode-generator";

interface QRCodeProps {
  value: string;
  size?: number;
  className?: string;
}

/**
 * Real QR code component using qrcode-generator.
 *
 * Encodes value with Error Correction Level M and a 4-module quiet zone.
 * Uses #000000 modules on #FFFFFF light background for reliable optical scanning,
 * rendered at a minimum dimension of 200px regardless of theme.
 */
export default function QRCode({ value, size = 200, className = "" }: QRCodeProps) {
  const { moduleCount, isDark } = useMemo(() => {
    if (!value) {
      return { moduleCount: 0, isDark: () => false };
    }
    // Type 0 = auto-detect minimum version
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    return {
      moduleCount: qr.getModuleCount(),
      isDark: (r: number, c: number) => qr.isDark(r, c),
    };
  }, [value]);

  if (!value || moduleCount === 0) {
    return (
      <div
        style={{ width: Math.max(200, size), height: Math.max(200, size) }}
        className="flex items-center justify-center bg-white border border-[#A88B55] text-[11px] text-[#4A3A1F] text-center p-2 rounded-sm"
      >
        QR unavailable
      </div>
    );
  }

  // 4-module quiet zone per specification
  const quietZone = 4;
  const total = moduleCount + quietZone * 2;
  const renderedSize = Math.max(200, size);

  const rects: { x: number; y: number }[] = [];
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (isDark(r, c)) {
        rects.push({ x: c + quietZone, y: r + quietZone });
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={renderedSize}
      height={renderedSize}
      className={`rounded-sm bg-white border border-[#A88B55] inline-block ${className}`}
      aria-label={`QR Code link to envelope ${value}`}
      role="img"
    >
      <rect width={total} height={total} fill="#FFFFFF" />
      {rects.map((pt) => (
        <rect
          key={`${pt.y}-${pt.x}`}
          x={pt.x}
          y={pt.y}
          width={1}
          height={1}
          fill="#000000"
        />
      ))}
    </svg>
  );
}
