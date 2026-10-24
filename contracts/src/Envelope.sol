// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Envelope
/// @notice Lock BOT under a secret code with a commit-reveal scheme.
///
/// @dev What this contract deliberately cannot do:
/// - It cannot prevent anyone who discovers the secret code from claiming the funds.
///   The code is the money.
/// - The sender cannot cancel or withdraw early before the expiry timestamp.
/// - It cannot guard against weak or guessable secret codes chosen by users.
/// - There is no owner, no backdoor, and no emergency pause.
contract Envelope {
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_NOTE_BYTES = 140;
    uint256 public constant MAX_SECRET_BYTES = 64;
    uint256 public constant MAX_PAGE = 50;

    enum State {
        Locked,    // 0: Active and claimable before expiry
        Redeemed,  // 1: Successfully claimed by recipient with secret
        Refunded,  // 2: Claimed back by sender after expiry
        Expired    // 3: Unclaimed and past expiry (ready for refund)
    }

    struct Env {
        address sender;       // 20 bytes ┐ slot 1
        uint64 expiresAt;     //  8 bytes │
        uint32 createdBlock;  //  4 bytes ┘ (allows single-block lookup of Locked log)
        bytes32 hash;         // 32 bytes   slot 2 (keccak256(secret))
        address taker;        // 20 bytes ┐ slot 3 (address(0) = locked, == sender = refunded, else redeemed)
        uint96 amount;        // 12 bytes ┘
    }

    struct Commit {
        bytes32 commitment;   // 32 bytes slot 1
        uint64 blockNo;       //  8 bytes slot 2
    }

    struct EnvView {
        uint256 id;
        address sender;
        uint96 amount;
        uint64 expiresAt;
        uint32 createdBlock;
        bytes32 hash;
        address taker;
        uint8 state;
    }

    mapping(uint256 => Env) private _envs;
    mapping(uint256 => mapping(address => Commit)) private _commits;
    mapping(address => uint256[]) private _envsBy;
    uint256 public envelopeCount;

    uint256 private _reentrancyLocked;

    event Locked(
        uint256 indexed id,
        address indexed sender,
        bytes32 hash,
        uint96 amount,
        uint64 expiresAt,
        string note
    );
    event Committed(uint256 indexed id, address indexed claimer);
    event Redeemed(uint256 indexed id, address indexed taker, uint96 amount);
    event Refunded(uint256 indexed id, address indexed sender, uint96 amount);

    error ZeroAmount();
    error AmountTooLarge();
    error EmptyHash();
    error BadDuration(uint64 duration);
    error NoteTooLong(uint256 length, uint256 max);
    error NoSuchEnvelope(uint256 id);
    error NotLocked(uint256 id);
    error Expired(uint256 id, uint64 expiresAt);
    error NotExpired(uint256 id, uint64 expiresAt);
    error SecretTooLong(uint256 length, uint256 max);
    error NotCommitted(uint256 id, address who);
    error TooSoon(uint64 commitBlock, uint256 currentBlock);
    error BadCommitment();
    error WrongSecret();
    error NotSender(uint256 id, address caller);
    error TransferFailed();

    modifier nonReentrant() {
        if (_reentrancyLocked == 2) revert TransferFailed();
        _reentrancyLocked = 2;
        _;
        _reentrancyLocked = 1;
    }

    /// @notice Seals BOT inside a new envelope with a secret code hash and expiry.
    /// @param hash keccak256 hash of the normalized secret code.
    /// @param duration Expiration window in seconds.
    /// @param note Optional message for the recipient, recorded in event logs.
    function lock(
        bytes32 hash,
        uint64 duration,
        string calldata note
    ) external payable returns (uint256 id) {
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value > type(uint96).max) revert AmountTooLarge();
        if (hash == bytes32(0)) revert EmptyHash();
        if (duration < MIN_DURATION || duration > MAX_DURATION) {
            revert BadDuration(duration);
        }
        if (bytes(note).length > MAX_NOTE_BYTES) {
            revert NoteTooLong(bytes(note).length, MAX_NOTE_BYTES);
        }

        id = ++envelopeCount;
        uint64 expiresAt = uint64(block.timestamp) + duration;

        _envs[id] = Env({
            sender: msg.sender,
            expiresAt: expiresAt,
            createdBlock: uint32(block.number),
            hash: hash,
            taker: address(0),
            amount: uint96(msg.value)
        });

        _envsBy[msg.sender].push(id);

        emit Locked(id, msg.sender, hash, uint96(msg.value), expiresAt, note);
    }

    /// @notice Commits a claim attempt binding the secret and caller address in a prior block.
    /// @param id The envelope ID.
    /// @param commitment keccak256(abi.encode(id, secret, msg.sender)).
    function commit(uint256 id, bytes32 commitment) external {
        if (id == 0 || id > envelopeCount) revert NoSuchEnvelope(id);
        Env storage env = _envs[id];

        if (env.taker != address(0)) revert NotLocked(id);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= env.expiresAt) revert Expired(id, env.expiresAt);
        if (commitment == bytes32(0)) revert BadCommitment();

        _commits[id][msg.sender] = Commit({
            commitment: commitment,
            blockNo: uint64(block.number)
        });

        emit Committed(id, msg.sender);
    }

    /// @notice Reveals the secret to claim the envelope's funds after a prior commitment.
    /// @param id The envelope ID.
    /// @param secret The pre-image secret code matching the envelope's hash and commitment.
    function redeem(uint256 id, bytes calldata secret) external nonReentrant {
        if (id == 0 || id > envelopeCount) revert NoSuchEnvelope(id);
        Env storage env = _envs[id];

        if (env.taker != address(0)) revert NotLocked(id);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= env.expiresAt) revert Expired(id, env.expiresAt);
        if (secret.length > MAX_SECRET_BYTES) {
            revert SecretTooLong(secret.length, MAX_SECRET_BYTES);
        }

        Commit storage c = _commits[id][msg.sender];
        if (c.commitment == bytes32(0)) revert NotCommitted(id, msg.sender);
        if (block.number <= c.blockNo) revert TooSoon(c.blockNo, block.number);

        bytes32 expectedCommitment = keccak256(abi.encode(id, secret, msg.sender));
        if (expectedCommitment != c.commitment) revert BadCommitment();

        if (keccak256(secret) != env.hash) revert WrongSecret();

        // Effects before interaction
        env.taker = msg.sender;
        delete _commits[id][msg.sender];
        uint96 payout = env.amount;

        // Interaction
        (bool ok,) = msg.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Redeemed(id, msg.sender, payout);
    }

    /// @notice Reclaims funds to the creator after expiration.
    /// @param id The envelope ID.
    function refund(uint256 id) external nonReentrant {
        if (id == 0 || id > envelopeCount) revert NoSuchEnvelope(id);
        Env storage env = _envs[id];

        if (msg.sender != env.sender) revert NotSender(id, msg.sender);
        if (env.taker != address(0)) revert NotLocked(id);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < env.expiresAt) revert NotExpired(id, env.expiresAt);

        // Effects before interaction (taker == sender marks refunded)
        env.taker = env.sender;
        uint96 payout = env.amount;

        // Interaction
        (bool ok,) = env.sender.call{value: payout}("");
        if (!ok) revert TransferFailed();

        emit Refunded(id, env.sender, payout);
    }

    /// @notice Returns full metadata and current state for an envelope.
    function envelopeOf(uint256 id) external view returns (EnvView memory) {
        if (id == 0 || id > envelopeCount) revert NoSuchEnvelope(id);
        Env storage e = _envs[id];

        uint8 st;
        if (e.taker == e.sender && e.taker != address(0)) {
            st = uint8(State.Refunded);
        } else if (e.taker != address(0)) {
            st = uint8(State.Redeemed);
        // forge-lint: disable-next-line(block-timestamp)
        } else if (block.timestamp >= e.expiresAt) {
            st = uint8(State.Expired);
        } else {
            st = uint8(State.Locked);
        }

        return EnvView({
            id: id,
            sender: e.sender,
            amount: e.amount,
            expiresAt: e.expiresAt,
            createdBlock: e.createdBlock,
            hash: e.hash,
            taker: e.taker,
            state: st
        });
    }

    /// @notice Returns current commitment info for an address on an envelope.
    function commitOf(uint256 id, address who) external view returns (bytes32 commitment, uint64 blockNo) {
        Commit storage c = _commits[id][who];
        return (c.commitment, c.blockNo);
    }

    /// @notice Returns all envelope IDs created by a sender.
    function envelopesBy(address who) external view returns (uint256[] memory) {
        return _envsBy[who];
    }
}
