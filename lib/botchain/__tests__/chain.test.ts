import { describe, expect, it } from "vitest";
import {
  addressUrl,
  bohrTestnet,
  botChain,
  botChainById,
  faucetUrl,
  isBotChainId,
  txUrl,
  BOTCHAIN_SITE_URL,
  BOTCHAIN_EXPLORER_URL,
  footerLinks,
} from "../chain";
import { DEPLOYMENTS, ZERO_ADDRESS } from "../deployment";

describe("chain identity", () => {
  // These two numbers are the whole premise. Both were confirmed against the live RPCs on
  // 2026-10-16 (mainnet eth_chainId 0x2a5, Bohr 0x3c8); a typo here signs transactions for
  // another network.
  it("pins the chain IDs", () => {
    expect(botChain.id).toBe(677);
    expect(bohrTestnet.id).toBe(968);
  });

  it("recognises only BOT Chain networks", () => {
    expect(isBotChainId(677)).toBe(true);
    expect(isBotChainId(968)).toBe(true);
    expect(isBotChainId(1)).toBe(false);
    expect(isBotChainId(undefined)).toBe(false);
  });

  it("marks only the testnet as a testnet", () => {
    expect(botChain.testnet).toBeUndefined();
    expect(bohrTestnet.testnet).toBe(true);
  });
});

describe("explorer links", () => {
  const hash = "0xabc";

  it("points each network at its own explorer", () => {
    expect(txUrl(677, hash)).toBe("https://scan.botchain.ai/tx/0xabc");
    expect(txUrl(968, hash)).toBe("https://scan.bohr.life/tx/0xabc");
    expect(addressUrl(677, hash)).toBe("https://scan.botchain.ai/address/0xabc");
  });

  it("falls back to the testnet for an unknown chain", () => {
    expect(botChainById(1).id).toBe(bohrTestnet.id);
  });
});

describe("faucet", () => {
  it("offers one on testnet", () => {
    expect(faucetUrl(968)).toBe("https://faucet.botchain.ai/basic");
  });

  // Mainnet BOT comes from a bridge or a DEX swap. Promising a faucet that does not exist sends
  // the user to a dead end at the exact moment they need funds.
  it("offers none on mainnet", () => {
    expect(faucetUrl(677)).toBeNull();
  });
});

describe("footerLinks", () => {
  it("provides fixed site and explorer constants", () => {
    expect(BOTCHAIN_SITE_URL).toBe("https://botchain.ai");
    expect(BOTCHAIN_EXPLORER_URL).toBe("https://scan.botchain.ai");
  });

  it("handles chain 677 deployed and undeployed", () => {
    const saved = { ...DEPLOYMENTS[677] };
    try {
      DEPLOYMENTS[677] = {
        address: "0x1111111111111111111111111111111111111111",
        deployBlock: 100n,
      };
      const deployed = footerLinks(677);
      expect(deployed.site).toBe("https://botchain.ai");
      expect(deployed.explorer).toBe("https://scan.botchain.ai");
      expect(deployed.contract).toBe(
        "https://scan.botchain.ai/address/0x1111111111111111111111111111111111111111",
      );

      DEPLOYMENTS[677] = {
        address: ZERO_ADDRESS,
        deployBlock: 0n,
      };
      const undeployed = footerLinks(677);
      expect(undeployed.site).toBe("https://botchain.ai");
      expect(undeployed.explorer).toBe("https://scan.botchain.ai");
      expect(undeployed.contract).toBeNull();
    } finally {
      DEPLOYMENTS[677] = saved;
    }
  });

  it("handles chain 968 deployed and undeployed", () => {
    const saved = { ...DEPLOYMENTS[968] };
    try {
      DEPLOYMENTS[968] = {
        address: "0x2222222222222222222222222222222222222222",
        deployBlock: 200n,
      };
      const deployed = footerLinks(968);
      expect(deployed.site).toBe("https://botchain.ai");
      expect(deployed.explorer).toBe("https://scan.botchain.ai");
      expect(deployed.contract).toBe(
        "https://scan.bohr.life/address/0x2222222222222222222222222222222222222222",
      );

      DEPLOYMENTS[968] = {
        address: ZERO_ADDRESS,
        deployBlock: 0n,
      };
      const undeployed = footerLinks(968);
      expect(undeployed.site).toBe("https://botchain.ai");
      expect(undeployed.explorer).toBe("https://scan.botchain.ai");
      expect(undeployed.contract).toBeNull();
    } finally {
      DEPLOYMENTS[968] = saved;
    }
  });
});

