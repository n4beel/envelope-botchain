import { describe, expect, it } from "vitest";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";

function rasterizeQr(value: string, quietZone: number = 4, scale: number = 4): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + quietZone * 2;
  const width = total * scale;
  const height = total * scale;

  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255); // initialize white background (R=255, G=255, B=255, A=255)

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        for (let py = 0; py < scale; py++) {
          for (let px = 0; px < scale; px++) {
            const x = (c + quietZone) * scale + px;
            const y = (r + quietZone) * scale + py;
            const idx = (y * width + x) * 4;
            data[idx] = 0;     // R
            data[idx + 1] = 0; // G
            data[idx + 2] = 0; // B
            data[idx + 3] = 255; // A
          }
        }
      }
    }
  }

  return { data, width, height };
}

describe("QR Code optical decode verification", () => {
  it("decodes a real Claimcheck link back to the exact string", () => {
    const claimUrl = "https://claimcheck.botchain-apps.dev/c/42";
    const { data, width, height } = rasterizeQr(claimUrl);

    const result = jsQR(data, width, height);
    expect(result).not.toBeNull();
    expect(result?.data).toBe(claimUrl);
  });

  it("decodes a real Envelope link with 26-char anchor fragment back to the exact string", () => {
    const envelopeUrl = "https://envelope.botchain-apps.dev/e/7#abc123xyz456def789ghi012jk";
    const { data, width, height } = rasterizeQr(envelopeUrl);

    const result = jsQR(data, width, height);
    expect(result).not.toBeNull();
    expect(result?.data).toBe(envelopeUrl);
  });
});
