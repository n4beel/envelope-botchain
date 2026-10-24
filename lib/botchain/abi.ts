/**
 * Envelope contract ABI. Hand-written `as const` for strict viem / wagmi typing.
 */
export const envelopeAbi = [
  {
    type: "function",
    name: "lock",
    stateMutability: "payable",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "duration", type: "uint64" },
      { name: "note", type: "string" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "secret", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "envelopeOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "env",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "sender", type: "address" },
          { name: "amount", type: "uint96" },
          { name: "expiresAt", type: "uint64" },
          { name: "createdBlock", type: "uint32" },
          { name: "hash", type: "bytes32" },
          { name: "taker", type: "address" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "commitOf",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [
      { name: "commitment", type: "bytes32" },
      { name: "blockNo", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "envelopesBy",
    stateMutability: "view",
    inputs: [{ name: "who", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "envelopeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_NOTE_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_SECRET_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_PAGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Locked",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "hash", type: "bytes32", indexed: false },
      { name: "amount", type: "uint96", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
      { name: "note", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Committed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "claimer", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "taker", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Refunded",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount", type: "uint96", indexed: false },
    ],
  },
  {
    type: "error",
    name: "ZeroAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "AmountTooLarge",
    inputs: [],
  },
  {
    type: "error",
    name: "EmptyHash",
    inputs: [],
  },
  {
    type: "error",
    name: "BadDuration",
    inputs: [{ name: "duration", type: "uint64" }],
  },
  {
    type: "error",
    name: "NoteTooLong",
    inputs: [
      { name: "length", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NoSuchEnvelope",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "NotLocked",
    inputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "error",
    name: "Expired",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "NotExpired",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "SecretTooLong",
    inputs: [
      { name: "length", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NotCommitted",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "who", type: "address" },
    ],
  },
  {
    type: "error",
    name: "TooSoon",
    inputs: [
      { name: "commitBlock", type: "uint64" },
      { name: "currentBlock", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "BadCommitment",
    inputs: [],
  },
  {
    type: "error",
    name: "WrongSecret",
    inputs: [],
  },
  {
    type: "error",
    name: "NotSender",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "caller", type: "address" },
    ],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
] as const;

export const contractAbi = envelopeAbi;
