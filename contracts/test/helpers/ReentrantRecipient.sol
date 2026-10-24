// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Envelope} from "../../src/Envelope.sol";

contract ReentrantRecipient {
    Envelope public target;
    uint256 public envelopeId;
    bytes public secret;
    bool public attacked;

    constructor(Envelope target_) {
        target = target_;
    }

    function setEnvelope(uint256 id, bytes calldata secret_) external {
        envelopeId = id;
        secret = secret_;
    }

    receive() external payable {
        if (!attacked) {
            attacked = true;
            // Attempt reentrancy into redeem
            target.redeem(envelopeId, secret);
        }
    }
}
