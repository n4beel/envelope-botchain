import { describe, expect, it, vi } from "vitest";
import {
  CROCKFORD_ALPHABET,
  byteLength,
  normalizeCode,
  formatCode,
  generateSecretCode,
  secretBytes,
  hashOf,
  commitmentFor,
  entropyBits,
  stateLabel,
  buildShareUrl,
  parseFragmentCode,
  loadEnvelopeNote,
} from "../envelope";
import { keccak256, toHex } from "viem";

describe("envelope lib utilities", () => {
  describe("byteLength", () => {
    it("computes utf-8 byte length correctly", () => {
      expect(byteLength("")).toBe(0);
      expect(byteLength("hello")).toBe(5);
      expect(byteLength("hello ✉️")).toBe(12); // 6 ascii + 1 space + 3 symbol + 2 variation selector
    });
  });

  describe("normalizeCode", () => {
    it("converts lowercase to uppercase", () => {
      expect(normalizeCode("abcd")).toBe("ABCD");
    });

    it("strips whitespace and hyphens", () => {
      expect(normalizeCode("AB-CD EF - GH")).toBe("ABCDEFGH");
    });

    it("maps I and L to 1", () => {
      expect(normalizeCode("iIlL")).toBe("1111");
    });

    it("maps O to 0", () => {
      expect(normalizeCode("oO")).toBe("00");
    });

    it("normalizes a full formatted code with mixed cases and substitutions", () => {
      expect(normalizeCode("ab-io-lx-99")).toBe("AB101X99");
    });
  });

  describe("formatCode", () => {
    it("formats 26 character codes with hyphens every 4 chars", () => {
      const code = "0123456789ABCDEFGHJKMNPQRS";
      expect(formatCode(code)).toBe("0123-4567-89AB-CDEF-GHJK-MNPQ-RS");
    });

    it("formats short strings", () => {
      expect(formatCode("abcd")).toBe("ABCD");
      expect(formatCode("abcde")).toBe("ABCD-E");
    });
  });

  describe("generateSecretCode", () => {
    it("generates a 26 Crockford character code formatted with hyphens", () => {
      const code = generateSecretCode();
      const norm = normalizeCode(code);
      expect(norm).toHaveLength(26);
      for (const char of norm) {
        expect(CROCKFORD_ALPHABET).toContain(char);
      }
    });

    it("generates distinct codes across calls", () => {
      const c1 = generateSecretCode();
      const c2 = generateSecretCode();
      expect(c1).not.toBe(c2);
    });
  });

  describe("secretBytes and hashOf", () => {
    it("produces correct UTF-8 bytes for normalised code", () => {
      const code = "ABCD";
      const expectedHex = toHex(new TextEncoder().encode("ABCD"));
      expect(secretBytes(code)).toBe(expectedHex);
    });

    it("computes keccak256 hash matching manual calculation", () => {
      const code = "TEST-CODE";
      const norm = normalizeCode(code);
      const expectedHash = keccak256(toHex(new TextEncoder().encode(norm)));
      expect(hashOf(code)).toBe(expectedHash);
    });

    it("treats equivalent codes with different casing/hyphens identically", () => {
      expect(hashOf("test-code")).toBe(hashOf("TESTCODE"));
      expect(hashOf("il-o")).toBe(hashOf("11-0"));
    });
  });

  describe("commitmentFor", () => {
    it("computes deterministic commitment for id, code, and claimer", () => {
      const claimer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const c1 = commitmentFor(1n, "SECRET-1234", claimer);
      const c2 = commitmentFor(1, "secret1234", claimer);
      expect(c1).toBe(c2);
      expect(c1.startsWith("0x")).toBe(true);
      expect(c1).toHaveLength(66);
    });

    it("differs for different claimers", () => {
      const c1 = commitmentFor(1n, "CODE", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
      const c2 = commitmentFor(1n, "CODE", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
      expect(c1).not.toBe(c2);
    });

    it("differs for different ids", () => {
      const claimer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const c1 = commitmentFor(1n, "CODE", claimer);
      const c2 = commitmentFor(2n, "CODE", claimer);
      expect(c1).not.toBe(c2);
    });
  });

  describe("entropyBits", () => {
    it("returns 0 for empty string", () => {
      expect(entropyBits("")).toBe(0);
    });

    it("calculates entropy based on character sets", () => {
      // 10 digits: pool = 10, log2(10) ≈ 3.32
      const digitsOnly = entropyBits("12345678");
      expect(digitsOnly).toBe(Math.round(8 * Math.log2(10)));

      // Lowercase letters: pool = 26, log2(26) ≈ 4.70
      const lettersOnly = entropyBits("abcdefgh");
      expect(lettersOnly).toBe(Math.round(8 * Math.log2(26)));

      // Mixed: pool = 26 + 26 + 10 = 62
      const mixed = entropyBits("Abc123Z9");
      expect(mixed).toBe(Math.round(8 * Math.log2(62)));
    });
  });

  describe("stateLabel", () => {
    it("returns Opened for state 1", () => {
      expect(stateLabel(1)).toBe("Opened");
    });

    it("returns Returned to Sender for state 2", () => {
      expect(stateLabel(2)).toBe("Returned to Sender");
    });

    it("returns Expired for state 3", () => {
      expect(stateLabel(3)).toBe("Expired");
    });

    it("returns Expired if state is 0 but expiresAt is in past", () => {
      expect(stateLabel(0, 1000n, 2000)).toBe("Expired");
    });

    it("returns Sealed if state is 0 and expiresAt is in future", () => {
      expect(stateLabel(0, 3000n, 2000)).toBe("Sealed");
    });

    it("returns Sealed if state is 0 and no expiresAt provided", () => {
      expect(stateLabel(0)).toBe("Sealed");
    });
  });

  describe("buildShareUrl and parseFragmentCode", () => {
    it("builds URL with normalized code in fragment", () => {
      const url = buildShareUrl(42n, "code-1234", "https://envelope.botchain-apps.dev");
      expect(url).toBe("https://envelope.botchain-apps.dev/e/42#C0DE1234");
      expect(url).not.toContain("?");
    });

    it("strips trailing slashes from origin", () => {
      const url = buildShareUrl(1n, "test", "http://localhost:3000///");
      expect(url).toBe("http://localhost:3000/e/1#TEST");
    });

    it("parses code from fragment", () => {
      expect(parseFragmentCode("#my-secret")).toBe("MYSECRET");
      expect(parseFragmentCode("my-secret")).toBe("MYSECRET");
      expect(parseFragmentCode("#  IL-OO  ")).toBe("1100");
    });
  });

  describe("loadEnvelopeNote", () => {
    it("loads note from log and caches result", async () => {
      const mockClient = {
        getLogs: vi.fn().mockResolvedValue([
          {
            args: {
              id: 1n,
              note: "Happy Birthday!",
            },
          },
        ]),
      } as any;

      const note = await loadEnvelopeNote(
        mockClient,
        "0x1234567890123456789012345678901234567890",
        1n,
        100n
      );
      expect(note).toBe("Happy Birthday!");
      expect(mockClient.getLogs).toHaveBeenCalledTimes(1);

      // Calling again should read from cache
      const cached = await loadEnvelopeNote(
        mockClient,
        "0x1234567890123456789012345678901234567890",
        1n,
        100n
      );
      expect(cached).toBe("Happy Birthday!");
      expect(mockClient.getLogs).toHaveBeenCalledTimes(1);
    });

    it("returns empty string if createdBlock <= 0", async () => {
      const mockClient = { getLogs: vi.fn() } as any;
      const note = await loadEnvelopeNote(
        mockClient,
        "0x1234567890123456789012345678901234567890",
        2n,
        0n
      );
      expect(note).toBe("");
      expect(mockClient.getLogs).not.toHaveBeenCalled();
    });

    it("handles error gracefully by returning empty string", async () => {
      const mockClient = {
        getLogs: vi.fn().mockRejectedValue(new Error("RPC failure")),
      } as any;
      const note = await loadEnvelopeNote(
        mockClient,
        "0x9999999999999999999999999999999999999999",
        99n,
        500n
      );
      expect(note).toBe("");
    });
  });
});
