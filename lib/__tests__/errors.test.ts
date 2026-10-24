import { describe, expect, it } from "vitest";
import {
  describeError,
  extractRevert,
  isUserRejection,
  shortAddress,
} from "../errors";

describe("errors helper utilities", () => {
  describe("shortAddress", () => {
    it("formats 42-char addresses cleanly", () => {
      expect(
        shortAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
      ).toBe("0x7099…79C8");
    });

    it("returns short input as is", () => {
      expect(shortAddress("0x123")).toBe("0x123");
      expect(shortAddress("")).toBe("");
    });
  });

  describe("isUserRejection", () => {
    it("detects user rejection from standard error messages", () => {
      expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
      expect(isUserRejection(new Error("user rejected transaction"))).toBe(true);
      expect(isUserRejection(new Error("User denied transaction signature"))).toBe(true);
      expect(isUserRejection(new Error("ACTION_REJECTED"))).toBe(true);
    });

    it("detects error code 4001", () => {
      expect(isUserRejection({ code: 4001, message: "Metamask error" })).toBe(true);
    });

    it("returns false for non-rejections", () => {
      expect(isUserRejection(new Error("Out of gas"))).toBe(false);
      expect(isUserRejection(null)).toBe(false);
      expect(isUserRejection(undefined)).toBe(false);
    });
  });

  describe("extractRevert and describeError", () => {
    it("handles user rejections with clean copy", () => {
      expect(describeError(new Error("User rejected the request"))).toBe(
        "Transaction cancelled in wallet."
      );
    });

    it("translates WrongSecret", () => {
      const err = { data: { errorName: "WrongSecret" } };
      expect(describeError(err)).toBe("That code doesn't open this envelope.");
    });

    it("translates NotCommitted", () => {
      const err = { data: { errorName: "NotCommitted" } };
      expect(describeError(err)).toBe("One moment — preparing your claim.");
    });

    it("translates TooSoon", () => {
      const err = { data: { errorName: "TooSoon" } };
      expect(describeError(err)).toBe(
        "One moment — waiting for the commit to be confirmed on-chain."
      );
    });

    it("translates Expired with and without timestamp arg", () => {
      const errNoArg = { data: { errorName: "Expired" } };
      expect(describeError(errNoArg)).toBe("This envelope has expired.");

      const errWithArg = { data: { errorName: "Expired", args: [1n, 1760000000n] } };
      const dateStr = new Date(1760000000 * 1000).toLocaleString();
      expect(describeError(errWithArg)).toBe(
        `This envelope expired on ${dateStr}.`
      );
    });

    it("translates NotExpired with and without timestamp arg", () => {
      const errNoArg = { data: { errorName: "NotExpired" } };
      expect(describeError(errNoArg)).toBe(
        "This envelope has not reached its expiration date."
      );

      const errWithArg = { data: { errorName: "NotExpired", args: [1n, 1760000000n] } };
      const dateStr = new Date(1760000000 * 1000).toLocaleString();
      expect(describeError(errWithArg)).toBe(
        `You can take it back after ${dateStr}.`
      );
    });

    it("translates NotLocked", () => {
      const err = { data: { errorName: "NotLocked" } };
      expect(describeError(err)).toBe(
        "This envelope has already been opened or returned."
      );
    });

    it("translates NotSender", () => {
      const err = { data: { errorName: "NotSender" } };
      expect(describeError(err)).toBe("Only the sender can take it back.");
    });

    it("translates BadDuration", () => {
      const err = { data: { errorName: "BadDuration" } };
      expect(describeError(err)).toBe("Choose between one hour and a year.");
    });

    it("translates NoteTooLong with and without args", () => {
      const errWithArgs = {
        data: { errorName: "NoteTooLong", args: [150n, 140n] },
      };
      expect(describeError(errWithArgs)).toBe(
        "Notes run to 140 bytes; yours is 150."
      );

      const errNoArgs = { data: { errorName: "NoteTooLong" } };
      expect(describeError(errNoArgs)).toBe("Note exceeds length limit.");
    });

    it("translates ZeroAmount", () => {
      const err = { data: { errorName: "ZeroAmount" } };
      expect(describeError(err)).toBe("Put something in the envelope.");
    });

    it("translates AmountTooLarge", () => {
      const err = { data: { errorName: "AmountTooLarge" } };
      expect(describeError(err)).toBe("Amount exceeds protocol maximum.");
    });

    it("translates EmptyHash", () => {
      const err = { data: { errorName: "EmptyHash" } };
      expect(describeError(err)).toBe("Secret code hash cannot be empty.");
    });

    it("translates SecretTooLong", () => {
      const err = { data: { errorName: "SecretTooLong" } };
      expect(describeError(err)).toBe("Secret code is too long (maximum 64 bytes).");
    });

    it("translates BadCommitment", () => {
      const err = { data: { errorName: "BadCommitment" } };
      expect(describeError(err)).toBe(
        "Commitment does not match this envelope or wallet."
      );
    });

    it("translates NoSuchEnvelope", () => {
      const err = { data: { errorName: "NoSuchEnvelope" } };
      expect(describeError(err)).toBe("Envelope does not exist.");
    });

    it("translates TransferFailed", () => {
      const err = { data: { errorName: "TransferFailed" } };
      expect(describeError(err)).toBe("BOT transfer failed.");
    });

    it("handles error messages matching error patterns in string", () => {
      expect(describeError(new Error("execution reverted: WrongSecret"))).toBe(
        "That code doesn't open this envelope."
      );
      expect(describeError(new Error("execution reverted: NotLocked"))).toBe(
        "This envelope has already been opened or returned."
      );
      expect(describeError(new Error("execution reverted: Expired"))).toBe(
        "This envelope has expired."
      );
      expect(describeError(new Error("connector not connected"))).toBe(
        "Please connect your wallet."
      );
    });

    it("falls back to error message or generic string", () => {
      expect(describeError(new Error("A short error message"))).toBe(
        "A short error message"
      );

      const longMessage = "A".repeat(150);
      const described = describeError(new Error(longMessage));
      expect(described).toHaveLength(118);
      expect(described.endsWith("…")).toBe(true);

      expect(describeError(null)).toBe(
        "An unexpected error occurred. Please try again."
      );
    });
  });
});
