// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/Helpers.sol";
import "./callback/TokenCallbackHandler.sol";
import "./SessionManager.sol";

contract GokiteAccount is
    BaseAccount,
    SessionManager,
    TokenCallbackHandler,
    UUPSUpgradeable,
    Initializable
{
    using SafeERC20 for IERC20;

    // EIP-712 Domain
    string public constant DOMAIN_NAME = "GokiteAccount";
    string public constant DOMAIN_VERSION = "1";

    // EIP-712 TypeHash for TransferWithAuthorization
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    // EIP-712 Domain TypeHash
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    struct Storage {
        address owner;
    }

    /**
     * @notice Transfer authorization structure for EIP-712 signing
     */
    struct TransferWithAuthorization {
        address from;
        address to;
        address token;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    error NotAuthorized(address caller);
    error ArrayLengthMismatch();
    error InvalidOwner();
    error InvalidFromAddress();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error InvalidSignature();

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    event ContractCreated(address indexed contractAddress);

    IEntryPoint private immutable _entryPoint;

    // keccak256(abi.encode(uint256(keccak256("kiteai.storage.GokiteAccount")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _storageLocation =
        0xf71d4428028e21c03a223e2faf5b6f8ce488514fbe98a4cd7a54868714452c00;

    event GokiteAccountInitialized(
        IEntryPoint indexed entryPoint,
        address indexed owner
    );

    /**
     * @dev Modifier to check if the caller is authorized to execute the function.
     * The caller can be the owner, the account itself (which gets redirected through execute()), or the entry point.
     */
    modifier onlyAuthorized() {
        _onlyAuthorized();
        _;
    }

    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }

    function _getStorage() private pure returns (Storage storage $) {
        assembly {
            $.slot := _storageLocation
        }
    }

    function _onlyAuthorized() internal view {
        Storage storage $ = _getStorage();
        if (
            msg.sender != $.owner &&
            msg.sender != address(this) &&
            msg.sender != address(entryPoint())
        ) {
            revert NotAuthorized(msg.sender);
        }
    }

    function _transferOwnership(address newOwner) internal virtual {
        Storage storage $ = _getStorage();
        address oldOwner = $.owner;
        if (newOwner == oldOwner) {
            revert InvalidOwner();
        }
        $.owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    // ============ EIP-712 Functions ============

    /**
     * @notice Returns the domain separator for EIP-712 signatures
     */
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(DOMAIN_NAME)),
                    keccak256(bytes(DOMAIN_VERSION)),
                    block.chainid,
                    address(this)
                )
            );
    }

    /**
     * @notice Hash a TransferWithAuthorization struct for EIP-712 signing
     */
    function _hashTransferWithAuthorization(
        TransferWithAuthorization calldata auth
    ) internal pure returns (bytes32) {
        return
            keccak256(
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
    }

    /**
     * @notice Compute the EIP-712 digest for a struct hash
     */
    function _hashTypedDataV4(
        bytes32 structHash
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash)
            );
    }

    // ============ Transfer With Authorization ============

    /**
     * @notice Execute a transfer with EIP-712 signed authorization from session agent
     * @param sessionId The session to use for spending rules
     * @param auth The transfer authorization details
     * @param signature The EIP-712 signature from session agent
     *
     * The signature must be created by the session's agent using EIP-712 typed data signing.
     * This allows the agent to pre-authorize transfers that can be executed by anyone.
     */
    function executeTransferWithAuthorization(
        bytes32 sessionId,
        TransferWithAuthorization calldata auth,
        bytes calldata signature,
        bytes calldata metadata
    ) external {
        // 1. Validate from address is this contract
        if (auth.from != address(this)) {
            revert InvalidFromAddress();
        }

        // 2. Validate time window
        if (block.timestamp <= auth.validAfter) {
            revert AuthorizationNotYetValid();
        }
        if (block.timestamp >= auth.validBefore) {
            revert AuthorizationExpired();
        }

        // 3. Validate token is supported
        _validateToken(auth.token);

        // 4. Validate nonce is not used (will revert if used)
        _markNonceUsed(auth.nonce);

        // 5. Verify EIP-712 signature
        bytes32 structHash = _hashTransferWithAuthorization(auth);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        // 6. Verify signer is the session's agent
        address agent = getSessionAgent(sessionId);
        if (signer != agent) {
            revert InvalidSignature();
        }

        // 7. Normalize amount to standard decimals
        uint256 normalizedAmount = _normalizeAmount(auth.token, auth.value);

        // 8. Check master budget
        if (!_checkMasterBudget(normalizedAmount)) {
            revert MasterBudgetExceeded();
        }

        // 9. Check and update session spending rules (using empty provider for general transfers)
        if (
            !_checkAndUpdateSpendingRules(
                sessionId,
                normalizedAmount,
                bytes32(0)
            )
        ) {
            revert SpendingRuleNotPassed();
        }

        // 10. Update master budget usage
        _updateMasterBudgetUsage(normalizedAmount);

        // 11. Check balance
        uint256 balance = IERC20(auth.token).balanceOf(address(this));
        if (auth.value > balance) {
            revert InsufficientBalance();
        }

        // 12. Execute transfer
        IERC20(auth.token).safeTransfer(auth.to, auth.value);

        // 13. Emit event
        emit TransferExecuted(
            sessionId,
            auth.token,
            auth.to,
            auth.value,
            auth.nonce,
            metadata
        );
    }

    /**
     * @notice Execute a transfer with authorization and specify service provider
     * @param sessionId The session to use for spending rules
     * @param auth The transfer authorization details
     * @param signature The EIP-712 signature from session agent
     * @param serviceProvider The service provider identifier for spending rule matching
     */
    function executeTransferWithAuthorizationAndProvider(
        bytes32 sessionId,
        TransferWithAuthorization calldata auth,
        bytes calldata signature,
        bytes32 serviceProvider,
        bytes calldata metadata
    ) external {
        // 1. Validate from address is this contract
        if (auth.from != address(this)) {
            revert InvalidFromAddress();
        }

        // 2. Validate time window
        if (block.timestamp <= auth.validAfter) {
            revert AuthorizationNotYetValid();
        }
        if (block.timestamp >= auth.validBefore) {
            revert AuthorizationExpired();
        }

        // 3. Validate token is supported
        _validateToken(auth.token);

        // 4. Validate nonce is not used (will revert if used)
        _markNonceUsed(auth.nonce);

        // 5. Verify EIP-712 signature
        bytes32 structHash = _hashTransferWithAuthorization(auth);
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);

        // 6. Verify signer is the session's agent
        address agent = getSessionAgent(sessionId);
        if (signer != agent) {
            revert InvalidSignature();
        }

        // 7. Normalize amount to standard decimals
        uint256 normalizedAmount = _normalizeAmount(auth.token, auth.value);

        // 8. Check master budget
        if (!_checkMasterBudget(normalizedAmount)) {
            revert MasterBudgetExceeded();
        }

        // 9. Check and update session spending rules
        if (
            !_checkAndUpdateSpendingRules(
                sessionId,
                normalizedAmount,
                serviceProvider
            )
        ) {
            revert SpendingRuleNotPassed();
        }

        // 10. Update master budget usage
        _updateMasterBudgetUsage(normalizedAmount);

        // 11. Check balance
        uint256 balance = IERC20(auth.token).balanceOf(address(this));
        if (auth.value > balance) {
            revert InsufficientBalance();
        }

        // 12. Execute transfer
        IERC20(auth.token).safeTransfer(auth.to, auth.value);

        // 13. Emit event
        emit TransferExecuted(
            sessionId,
            auth.token,
            auth.to,
            auth.value,
            auth.nonce,
            metadata
        );
    }

    // ============ Execute Functions ============

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     * @param dest destination address to call
     * @param value the value to pass in this call
     * @param func the calldata to pass in this call
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external onlyAuthorized {
        _call(dest, value, func);
    }

    /**
     * execute a sequence of transactions
     * @dev to reduce gas consumption for trivial case (no value), use a zero-length array to mean zero value
     * @param dest an array of destination addresses
     * @param value an array of values to pass to each call. can be zero-length for no-value calls
     * @param func an array of calldata to pass to each call
     */
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external onlyAuthorized {
        if (
            dest.length != func.length ||
            (value.length != 0 && value.length != func.length)
        ) {
            revert ArrayLengthMismatch();
        }
        if (value.length == 0) {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], 0, func[i]);
            }
        } else {
            for (uint256 i = 0; i < dest.length; i++) {
                _call(dest[i], value[i], func[i]);
            }
        }
    }

    /**
     * @notice Creates a contract.
     * @param value The value to send to the new contract constructor.
     * @param initCode The initCode to deploy.
     * @return createdAddr The created contract address.
     *
     * @dev Assembly procedure:
     *      1. Load the free memory pointer.
     *      2. Get the initCode length.
     *      3. Copy the initCode from callata to memory at the free memory pointer.
     *      4. Create the contract.
     *      5. If creation failed (the address returned is zero), revert with CreateFailed().
     */
    function performCreate(
        uint256 value,
        bytes calldata initCode
    ) public payable virtual onlyAuthorized returns (address createdAddr) {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            let len := initCode.length
            calldatacopy(fmp, initCode.offset, len)

            createdAddr := create(value, fmp, len)

            if iszero(createdAddr) {
                mstore(0x00, 0x7e16b8cd)
                revert(0x1c, 0x04)
            }
        }
        emit ContractCreated(createdAddr);
    }

    /**
     * @notice Creates a contract using create2 deterministic deployment.
     * @param value The value to send to the new contract constructor.
     * @param initCode The initCode to deploy.
     * @param salt The salt to use for the create2 operation.
     * @return createdAddr The created contract address.
     *
     * @dev Assembly procedure:
     *      1. Load the free memory pointer.
     *      2. Get the initCode length.
     *      3. Copy the initCode from callata to memory at the free memory pointer.
     *      4. Create the contract using Create2 with the passed salt parameter.
     *      5. If creation failed (the address returned is zero), revert with CreateFailed().
     */
    function performCreate2(
        uint256 value,
        bytes calldata initCode,
        bytes32 salt
    ) external payable virtual onlyAuthorized returns (address createdAddr) {
        assembly ("memory-safe") {
            let fmp := mload(0x40)
            let len := initCode.length
            calldatacopy(fmp, initCode.offset, len)

            createdAddr := create2(value, fmp, len, salt)

            if iszero(createdAddr) {
                mstore(0x00, 0x7e16b8cd)
                revert(0x1c, 0x04)
            }
        }
        emit ContractCreated(createdAddr);
    }

    // ============ Initialization ============

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of SimpleAccount must be deployed with the new EntryPoint address, then upgrading
     * the implementation by calling `upgradeTo()`
     * @param anOwner the owner (signer) of this account
     */
    function initialize(address anOwner) public virtual initializer {
        _initialize(anOwner);
    }

    function _initialize(address anOwner) internal virtual {
        Storage storage $ = _getStorage();
        $.owner = anOwner;
        emit GokiteAccountInitialized(_entryPoint, $.owner);
    }

    // ============ Owner Management ============

    function owner() public view returns (address) {
        Storage storage $ = _getStorage();
        return $.owner;
    }

    function transferOwnership(address newOwner) public virtual onlyAuthorized {
        if (newOwner == address(0)) {
            revert InvalidOwner();
        }
        _transferOwnership(newOwner);
    }

    // ============ Signature Validation ============

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal virtual override returns (uint256 validationData) {
        Storage storage $ = _getStorage();
        if (
            $.owner !=
            ECDSA.recover(
                MessageHashUtils.toEthSignedMessageHash(userOpHash),
                userOp.signature
            )
        ) return SIG_VALIDATION_FAILED;
        return SIG_VALIDATION_SUCCESS;
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    // ============ Deposit Management ============

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(
        address payable withdrawAddress,
        uint256 amount
    ) public onlyAuthorized {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    // ============ Upgrade ============

    function _authorizeUpgrade(
        address newImplementation
    ) internal view override {
        (newImplementation);
        _onlyAuthorized();
    }

    // ============ Session Admin ============

    function _isSessionAdmin(
        address caller
    ) internal view override returns (bool) {
        Storage storage $ = _getStorage();
        return
            caller == $.owner ||
            caller == address(this) ||
            caller == address(entryPoint());
    }
}
