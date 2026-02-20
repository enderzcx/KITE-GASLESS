// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./GokiteAccount.sol";

/**
 * @title GokiteAccountV2
 * @notice Minimal delegated-session userOp validation extension.
 *
 * Design:
 * - Keep owner signature path fully backward compatible.
 * - Add session-signer path for exactly one call shape:
 *   executeTransferWithAuthorizationAndProvider(...)
 * - No new storage variable is introduced in V2.
 */
contract GokiteAccountV2 is GokiteAccount {
    error SessionUserOpSelectorNotAllowed(bytes4 selector);
    error SessionUserOpInvalidSessionAgent(address expected, address actual);
    error SessionUserOpInvalidAuthSignature();
    error SessionUserOpRuleCheckFailed();
    error SessionUserOpInvalidFrom();
    error SessionUserOpInvalidTimeRange();
    error SessionUserOpInvalidMasterBudget();

    constructor(IEntryPoint anEntryPoint) GokiteAccount(anEntryPoint) {}

    /**
     * @inheritdoc GokiteAccount
     */
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        address currentOwner = owner();
        address recoveredOwner = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(userOpHash),
            userOp.signature
        );
        if (recoveredOwner == currentOwner) {
            return SIG_VALIDATION_SUCCESS;
        }

        // Fallback to delegated session-signature path.
        bool ok = _validateSessionUserOp(userOp, userOpHash, recoveredOwner);
        return ok ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    function version() external pure returns (string memory) {
        return "GokiteAccountV2-session-userop";
    }

    function _validateSessionUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        address sessionUserOpSigner
    ) internal view returns (bool) {
        userOpHash;
        bytes calldata callData = userOp.callData;
        if (callData.length < 4) {
            return false;
        }

        bytes4 selector = bytes4(callData[0:4]);
        if (selector != this.executeTransferWithAuthorizationAndProvider.selector) {
            return false;
        }

        (
            bytes32 sessionId,
            TransferWithAuthorization memory auth,
            bytes memory authSignature,
            bytes32 serviceProvider,
            bytes memory metadata
        ) = abi.decode(
                callData[4:],
                (bytes32, TransferWithAuthorization, bytes, bytes32, bytes)
            );
        metadata;

        if (auth.from != address(this)) {
            return false;
        }
        if (block.timestamp <= auth.validAfter || block.timestamp >= auth.validBefore) {
            return false;
        }

        address sessionAgent;
        try this.getSessionAgent(sessionId) returns (address a) {
            sessionAgent = a;
        } catch {
            return false;
        }
        if (sessionAgent != sessionUserOpSigner) {
            return false;
        }

        // Ensure transfer authorization signature is from the same delegated session signer.
        bytes32 authStructHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                auth.from,
                auth.to,
                auth.token,
                auth.value,
                auth.validAfter,
                auth.validBefore,
                auth.nonce
            )
        );
        bytes32 authDigest = _hashTypedDataV4(authStructHash);
        address recoveredAuthSigner = ECDSA.recover(authDigest, authSignature);
        if (recoveredAuthSigner != sessionUserOpSigner) {
            return false;
        }

        // Token supported + budget/rule checks as view preconditions.
        if (!isTokenSupported(auth.token)) {
            return false;
        }
        uint256 normalizedAmount = _normalizeAmount(auth.token, auth.value);
        if (!_checkMasterBudget(normalizedAmount)) {
            return false;
        }

        try this.checkSpendingRules(sessionId, normalizedAmount, serviceProvider) returns (
            bool pass
        ) {
            return pass;
        } catch {
            return false;
        }
    }
}
