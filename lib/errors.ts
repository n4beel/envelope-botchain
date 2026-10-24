import { BaseError, ContractFunctionRevertedError } from "viem";

export interface RevertDetails {
  errorName?: string;
  args?: readonly unknown[];
}

export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Traverses an error to extract the custom revert error name and arguments.
 */
export function extractRevert(err: unknown): RevertDetails | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  // Direct property check
  if (
    "data" in err &&
    (err as any).data &&
    typeof (err as any).data === "object" &&
    (err as any).data.errorName
  ) {
    return {
      errorName: (err as any).data.errorName,
      args: (err as any).data.args,
    };
  }
  if ("errorName" in err && typeof (err as any).errorName === "string") {
    return {
      errorName: (err as any).errorName,
      args: (err as any).args,
    };
  }

  // If it's a viem BaseError, use walk
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => {
      if (e instanceof ContractFunctionRevertedError) return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "data" in e &&
        Boolean((e as any).data?.errorName)
      )
        return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "errorName" in e &&
        Boolean((e as any).errorName)
      )
        return true;
      return false;
    });

    if (reverted) {
      const errorObj = reverted as any;
      if (errorObj.data?.errorName) {
        return {
          errorName: errorObj.data.errorName,
          args: errorObj.data.args,
        };
      }
      if (errorObj.errorName) {
        return {
          errorName: errorObj.errorName,
          args: errorObj.args,
        };
      }
    }
  }

  return undefined;
}

/**
 * Checks whether an error represents the user rejecting the prompt in their wallet.
 */
export function isUserRejection(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("User rejected") ||
    msg.includes("User denied") ||
    msg.includes("user rejected") ||
    msg.includes("ACTION_REJECTED") ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 4001)
  );
}

/**
 * Translates an error into user-facing copy for Envelope.
 */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) {
    return "Transaction cancelled in wallet.";
  }

  const rev = extractRevert(err);
  if (rev?.errorName) {
    switch (rev.errorName) {
      case "WrongSecret":
        return "That code doesn't open this envelope.";
      case "NotCommitted":
        return "One moment — preparing your claim.";
      case "TooSoon":
        return "One moment — waiting for the commit to be confirmed on-chain.";
      case "Expired": {
        const expiresAt = rev.args?.[1];
        if (expiresAt !== undefined) {
          const date = new Date(Number(expiresAt) * 1000);
          return `This envelope expired on ${date.toLocaleString()}.`;
        }
        return "This envelope has expired.";
      }
      case "NotExpired": {
        const expiresAt = rev.args?.[1];
        if (expiresAt !== undefined) {
          const date = new Date(Number(expiresAt) * 1000);
          return `You can take it back after ${date.toLocaleString()}.`;
        }
        return "This envelope has not reached its expiration date.";
      }
      case "NotLocked":
        return "This envelope has already been opened or returned.";
      case "NotSender":
        return "Only the sender can take it back.";
      case "BadDuration":
        return "Choose between one hour and a year.";
      case "NoteTooLong": {
        const len = rev.args?.[0];
        const max = rev.args?.[1] ?? 140;
        return len !== undefined
          ? `Notes run to ${max} bytes; yours is ${len}.`
          : "Note exceeds length limit.";
      }
      case "ZeroAmount":
        return "Put something in the envelope.";
      case "AmountTooLarge":
        return "Amount exceeds protocol maximum.";
      case "EmptyHash":
        return "Secret code hash cannot be empty.";
      case "SecretTooLong":
        return "Secret code is too long (maximum 64 bytes).";
      case "BadCommitment":
        return "Commitment does not match this envelope or wallet.";
      case "NoSuchEnvelope":
        return "Envelope does not exist.";
      case "TransferFailed":
        return "BOT transfer failed.";
    }
  }

  if (err instanceof Error) {
    const m = err.message;
    if (m.includes("WrongSecret")) {
      return "That code doesn't open this envelope.";
    }
    if (m.includes("NotLocked")) {
      return "This envelope has already been opened or returned.";
    }
    if (m.includes("Expired")) {
      return "This envelope has expired.";
    }
    if (m.includes("connector not connected")) {
      return "Please connect your wallet.";
    }
    return m.length < 120 ? m : `${m.slice(0, 117)}…`;
  }

  return "An unexpected error occurred. Please try again.";
}
