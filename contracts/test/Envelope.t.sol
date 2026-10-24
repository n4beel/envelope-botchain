// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test, console2} from "forge-std/Test.sol";
import {Envelope} from "../src/Envelope.sol";
import {ReentrantRecipient} from "./helpers/ReentrantRecipient.sol";

contract EnvelopeHandler is Test {
    Envelope public envelope;
    address[] public users;

    uint256[] public activeIds;
    mapping(uint256 => bytes) public secrets;
    mapping(uint256 => uint96) public amounts;
    mapping(uint256 => bool) public finalized;

    constructor(Envelope envelope_) {
        envelope = envelope_;

        users.push(makeAddr("alice"));
        users.push(makeAddr("bob"));
        users.push(makeAddr("charlie"));
        users.push(makeAddr("david"));

        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 1000 ether);
        }
    }

    function lock(uint8 userIdx, uint32 durationSecs, uint80 amountWei) external {
        address user = users[userIdx % users.length];
        uint64 duration = uint64(bound(durationSecs, 1 hours, 30 days));
        uint96 amt = uint96(bound(amountWei, 1 wei, 10 ether));

        bytes memory sec = abi.encodePacked("SEC-", vm.toString(amt), "-", vm.toString(block.timestamp));
        bytes32 h = keccak256(sec);

        vm.prank(user);
        uint256 id = envelope.lock{value: amt}(h, duration, "Handler Note");

        activeIds.push(id);
        secrets[id] = sec;
        amounts[id] = amt;
    }

    function commitAndRedeem(uint8 userIdx, uint256 idIdx) external {
        if (activeIds.length == 0) return;
        uint256 id = activeIds[idIdx % activeIds.length];
        if (finalized[id]) return;

        address user = users[userIdx % users.length];
        Envelope.EnvView memory v = envelope.envelopeOf(id);
        if (v.state != 0) return; // Must be locked

        bytes memory sec = secrets[id];
        bytes32 c = keccak256(abi.encode(id, sec, user));

        vm.prank(user);
        envelope.commit(id, c);

        // Advance 1 block
        vm.roll(block.number + 1);

        vm.prank(user);
        envelope.redeem(id, sec);
        finalized[id] = true;
    }

    function refund(uint256 idIdx) external {
        if (activeIds.length == 0) return;
        uint256 id = activeIds[idIdx % activeIds.length];
        if (finalized[id]) return;

        Envelope.EnvView memory v = envelope.envelopeOf(id);
        // forge-lint: disable-next-line(block-timestamp)
        if (v.state != 3 && block.timestamp < v.expiresAt) return;

        vm.prank(v.sender);
        envelope.refund(id);
        finalized[id] = true;
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function totalLocked() external view returns (uint256 sum) {
        for (uint256 i = 0; i < activeIds.length; i++) {
            uint256 id = activeIds[i];
            Envelope.EnvView memory v = envelope.envelopeOf(id);
            if (v.state == 0 || v.state == 3) {
                sum += v.amount;
            }
        }
    }
}

contract EnvelopeTest is Test {
    Envelope public envelope;
    EnvelopeHandler public handler;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");
    address public attacker = makeAddr("attacker");

    bytes public constant SECRET = "TEST-SECRET-1234-CODE";
    bytes32 public hashSecret;

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

    function setUp() public {
        vm.warp(1_760_000_000);
        vm.roll(100);

        envelope = new Envelope();
        hashSecret = keccak256(SECRET);

        handler = new EnvelopeHandler(envelope);
        targetContract(address(handler));

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);
        vm.deal(attacker, 100 ether);
    }

    function test_Lock_StoresAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit Locked(1, alice, hashSecret, 1 ether, 1_760_000_000 + 1 days, "For Coffee");

        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "For Coffee");
        assertEq(id, 1);
        assertEq(envelope.envelopeCount(), 1);

        Envelope.EnvView memory v = envelope.envelopeOf(1);
        assertEq(v.id, 1);
        assertEq(v.sender, alice);
        assertEq(v.amount, 1 ether);
        assertEq(v.expiresAt, 1_760_000_000 + 1 days);
        assertEq(v.createdBlock, 100);
        assertEq(v.hash, hashSecret);
        assertEq(v.taker, address(0));
        assertEq(v.state, 0); // Locked

        uint256[] memory byAlice = envelope.envelopesBy(alice);
        assertEq(byAlice.length, 1);
        assertEq(byAlice[0], 1);
    }

    function test_Lock_Rejects_Zero_TooLarge_EmptyHash_BadDuration_LongNote() public {
        // Zero amount
        vm.prank(alice);
        vm.expectRevert(Envelope.ZeroAmount.selector);
        envelope.lock{value: 0}(hashSecret, 1 days, "Note");

        // Amount too large (> type(uint96).max)
        vm.deal(alice, 100_000_000_000 ether);
        vm.prank(alice);
        vm.expectRevert(Envelope.AmountTooLarge.selector);
        envelope.lock{value: uint256(type(uint96).max) + 1}(hashSecret, 1 days, "Note");

        // Empty hash
        vm.prank(alice);
        vm.expectRevert(Envelope.EmptyHash.selector);
        envelope.lock{value: 1 ether}(bytes32(0), 1 days, "Note");

        // Duration too short (< 1 hour)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Envelope.BadDuration.selector, 59 minutes));
        envelope.lock{value: 1 ether}(hashSecret, 59 minutes, "Note");

        // Duration too long (> 365 days)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Envelope.BadDuration.selector, 366 days));
        envelope.lock{value: 1 ether}(hashSecret, 366 days, "Note");

        // Note too long (> 140 bytes)
        string memory longNote = new string(141);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Envelope.NoteTooLong.selector, 141, 140));
        envelope.lock{value: 1 ether}(hashSecret, 1 days, longNote);
    }

    function test_Commit_Redeem_HappyPath_PaysTaker() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 2 ether}(hashSecret, 1 days, "Gift");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));

        vm.expectEmit(true, true, false, false);
        emit Committed(id, bob);
        vm.prank(bob);
        envelope.commit(id, commitment);

        (bytes32 storedComm, uint64 commBlock) = envelope.commitOf(id, bob);
        assertEq(storedComm, commitment);
        assertEq(commBlock, 100);

        // Advance block number
        vm.roll(101);

        uint256 bobBalBefore = bob.balance;

        vm.expectEmit(true, true, false, true);
        emit Redeemed(id, bob, 2 ether);

        vm.prank(bob);
        envelope.redeem(id, SECRET);

        assertEq(bob.balance - bobBalBefore, 2 ether);

        Envelope.EnvView memory v = envelope.envelopeOf(id);
        assertEq(v.taker, bob);
        assertEq(v.state, 1); // Redeemed

        // Stored commit is cleared
        (bytes32 clearedComm, ) = envelope.commitOf(id, bob);
        assertEq(clearedComm, bytes32(0));
    }

    function test_Redeem_SameBlock_TooSoon() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        // Same block 100
        vm.expectRevert(abi.encodeWithSelector(Envelope.TooSoon.selector, 100, 100));
        vm.prank(bob);
        envelope.redeem(id, SECRET);
    }

    function test_Redeem_WithoutCommit_NotCommitted() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        vm.roll(105);
        vm.expectRevert(abi.encodeWithSelector(Envelope.NotCommitted.selector, id, bob));
        vm.prank(bob);
        envelope.redeem(id, SECRET);
    }

    function test_Redeem_StolenCalldata_Fails() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        // Bob commits
        bytes32 bobCommitment = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, bobCommitment);

        vm.roll(105);

        // Attacker sees Bob's SECRET in mempool/calldata and tries to redeem directly without their own commit
        vm.expectRevert(abi.encodeWithSelector(Envelope.NotCommitted.selector, id, attacker));
        vm.prank(attacker);
        envelope.redeem(id, SECRET);

        // Attacker tries to frontrun by committing in block 105, but cannot redeem in block 105 (TooSoon)
        bytes32 attackerCommitment = keccak256(abi.encode(id, SECRET, attacker));
        vm.prank(attacker);
        envelope.commit(id, attackerCommitment);

        vm.expectRevert(abi.encodeWithSelector(Envelope.TooSoon.selector, 105, 105));
        vm.prank(attacker);
        envelope.redeem(id, SECRET);

        // Meanwhile, Bob's redeem in block 105 succeeds!
        vm.prank(bob);
        envelope.redeem(id, SECRET);
        assertEq(envelope.envelopeOf(id).taker, bob);

        // Once mined, attacker even in block 106 cannot steal it (NotLocked)
        vm.roll(106);
        vm.expectRevert(abi.encodeWithSelector(Envelope.NotLocked.selector, id));
        vm.prank(attacker);
        envelope.redeem(id, SECRET);
    }

    function test_Redeem_WrongSecret() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes memory fakeSecret = "WRONG-FAKE-SECRET";
        bytes32 commitment = keccak256(abi.encode(id, fakeSecret, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        vm.roll(102);
        vm.expectRevert(Envelope.WrongSecret.selector);
        vm.prank(bob);
        envelope.redeem(id, fakeSecret);
    }

    function test_Redeem_CommitmentForOtherAddressOrId_BadCommitment() public {
        vm.prank(alice);
        uint256 id1 = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note 1");

        // Commit made with charlie's address
        bytes32 commitmentCharlie = keccak256(abi.encode(id1, SECRET, charlie));
        vm.prank(bob);
        envelope.commit(id1, commitmentCharlie);

        vm.roll(102);
        // Bob reveals, but commitment bound to charlie -> BadCommitment
        vm.expectRevert(Envelope.BadCommitment.selector);
        vm.prank(bob);
        envelope.redeem(id1, SECRET);

        // Commit made for id2 instead of id1
        bytes32 commitmentId2 = keccak256(abi.encode(99, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id1, commitmentId2);

        vm.roll(103);
        vm.expectRevert(Envelope.BadCommitment.selector);
        vm.prank(bob);
        envelope.redeem(id1, SECRET);
    }

    function test_Redeem_AfterExpiry() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        // Warp past expiry (1 days = 86400)
        vm.warp(block.timestamp + 1 days + 1);
        vm.roll(110);

        vm.expectRevert(abi.encodeWithSelector(Envelope.Expired.selector, id, 1_760_000_000 + 1 days));
        vm.prank(bob);
        envelope.redeem(id, SECRET);
    }

    function test_Commit_AfterExpiry() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        vm.warp(block.timestamp + 1 days + 1);

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        vm.expectRevert(abi.encodeWithSelector(Envelope.Expired.selector, id, 1_760_000_000 + 1 days));
        vm.prank(bob);
        envelope.commit(id, commitment);
    }

    function test_Recommit_Overwrites() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes32 comm1 = keccak256(abi.encode(id, "SECRET-1", bob));
        vm.prank(bob);
        envelope.commit(id, comm1);

        vm.roll(110);
        bytes32 comm2 = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, comm2);

        (, uint64 blockNo) = envelope.commitOf(id, bob);
        assertEq(blockNo, 110);

        // Same block 110 must fail
        vm.expectRevert(abi.encodeWithSelector(Envelope.TooSoon.selector, 110, 110));
        vm.prank(bob);
        envelope.redeem(id, SECRET);

        // Block 111 succeeds
        vm.roll(111);
        vm.prank(bob);
        envelope.redeem(id, SECRET);
        assertEq(envelope.envelopeOf(id).taker, bob);
    }

    function test_Refund_AfterExpiry_OnlySender() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1.5 ether}(hashSecret, 1 days, "Note");

        vm.warp(block.timestamp + 1 days);

        // Non-sender reverts NotSender
        vm.expectRevert(abi.encodeWithSelector(Envelope.NotSender.selector, id, bob));
        vm.prank(bob);
        envelope.refund(id);

        uint256 aliceBefore = alice.balance;
        vm.expectEmit(true, true, false, true);
        emit Refunded(id, alice, 1.5 ether);

        vm.prank(alice);
        envelope.refund(id);

        assertEq(alice.balance - aliceBefore, 1.5 ether);

        Envelope.EnvView memory v = envelope.envelopeOf(id);
        assertEq(v.taker, alice);
        assertEq(v.state, 2); // Refunded
    }

    function test_Refund_BeforeExpiry_NotExpired_Args() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(Envelope.NotExpired.selector, id, 1_760_000_000 + 1 days));
        vm.prank(alice);
        envelope.refund(id);
    }

    function test_Refund_AfterRedeem_NotLocked() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        vm.roll(105);
        vm.prank(bob);
        envelope.redeem(id, SECRET);

        vm.warp(block.timestamp + 2 days);

        vm.expectRevert(abi.encodeWithSelector(Envelope.NotLocked.selector, id));
        vm.prank(alice);
        envelope.refund(id);
    }

    function test_State_Decoding_AllFour() public {
        // 0: Locked
        vm.prank(alice);
        uint256 id1 = envelope.lock{value: 0.1 ether}(hashSecret, 2 days, "N1");
        assertEq(envelope.envelopeOf(id1).state, 0);

        // 3: Expired
        vm.warp(block.timestamp + 3 days);
        assertEq(envelope.envelopeOf(id1).state, 3);

        // 2: Refunded
        vm.prank(alice);
        envelope.refund(id1);
        assertEq(envelope.envelopeOf(id1).state, 2);

        // 1: Redeemed
        vm.prank(alice);
        uint256 id2 = envelope.lock{value: 0.1 ether}(hashSecret, 2 days, "N2");
        bytes32 c2 = keccak256(abi.encode(id2, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id2, c2);

        vm.roll(block.number + 1);
        vm.prank(bob);
        envelope.redeem(id2, SECRET);
        assertEq(envelope.envelopeOf(id2).state, 1);
    }

    function test_SecretTooLong_65() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        bytes memory longSecret = new bytes(65);
        bytes32 commitment = keccak256(abi.encode(id, longSecret, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        vm.roll(105);
        vm.expectRevert(abi.encodeWithSelector(Envelope.SecretTooLong.selector, 65, 64));
        vm.prank(bob);
        envelope.redeem(id, longSecret);
    }

    function test_ReentrantRecipient() public {
        ReentrantRecipient reentrant = new ReentrantRecipient(envelope);

        vm.prank(alice);
        uint256 id = envelope.lock{value: 1 ether}(hashSecret, 1 days, "Note");

        reentrant.setEnvelope(id, SECRET);

        bytes32 commitment = keccak256(abi.encode(id, SECRET, address(reentrant)));
        vm.prank(address(reentrant));
        envelope.commit(id, commitment);

        vm.roll(105);

        // Reentrant call into redeem must revert TransferFailed
        vm.expectRevert(Envelope.TransferFailed.selector);
        vm.prank(address(reentrant));
        envelope.redeem(id, SECRET);
    }

    function test_GasSnapshot_Lock() public {
        uint256 g0 = gasleft();
        vm.prank(alice);
        envelope.lock{value: 0.5 ether}(hashSecret, 1 days, "Snapshot Note");
        uint256 used = g0 - gasleft();

        assertLt(used, 175_000);
    }

    function test_GasSnapshot_Commit() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 0.5 ether}(hashSecret, 1 days, "Snapshot Note");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        uint256 g0 = gasleft();
        vm.prank(bob);
        envelope.commit(id, commitment);
        uint256 used = g0 - gasleft();

        assertLt(used, 75_000);
    }

    function test_GasSnapshot_Redeem() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 0.5 ether}(hashSecret, 1 days, "Snapshot Note");

        bytes32 commitment = keccak256(abi.encode(id, SECRET, bob));
        vm.prank(bob);
        envelope.commit(id, commitment);

        vm.roll(105);
        uint256 g0 = gasleft();
        vm.prank(bob);
        envelope.redeem(id, SECRET);
        uint256 used = g0 - gasleft();

        assertLt(used, 65_000);
    }

    function test_GasSnapshot_Refund() public {
        vm.prank(alice);
        uint256 id = envelope.lock{value: 0.5 ether}(hashSecret, 1 days, "Snapshot Note");

        vm.warp(block.timestamp + 1 days + 1);
        uint256 g0 = gasleft();
        vm.prank(alice);
        envelope.refund(id);
        uint256 used = g0 - gasleft();

        assertLt(used, 50_000);
    }

    function testFuzz_RandomSecretsRoundTrip(bytes memory randomSecret) public {
        vm.assume(randomSecret.length > 0 && randomSecret.length <= 64);

        bytes32 h = keccak256(randomSecret);
        vm.prank(alice);
        uint256 id = envelope.lock{value: 0.05 ether}(h, 2 hours, "Fuzz");

        bytes32 comm = keccak256(abi.encode(id, randomSecret, bob));
        vm.prank(bob);
        envelope.commit(id, comm);

        vm.roll(block.number + 1);
        vm.prank(bob);
        envelope.redeem(id, randomSecret);

        assertEq(envelope.envelopeOf(id).taker, bob);
    }

    function invariant_BalanceEqualsLocked() public view {
        assertEq(address(envelope).balance, handler.totalLocked());
    }
}
