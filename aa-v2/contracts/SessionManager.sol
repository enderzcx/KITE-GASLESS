// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SessionManager
 * @notice Provides session-scoped spending rule management for AA wallets.
 *         Each session is controlled by an agent (EOA) and maintains spending rules.
 */
abstract contract SessionManager {
    using SafeERC20 for IERC20;

    // Standard precision for internal calculations (18 decimals)
    uint256 public constant STANDARD_DECIMALS = 18;

    struct Rule {
        uint256 timeWindow;
        uint160 budget;
        uint96 initialWindowStartTime;
        bytes32[] targetProviders;
    }

    struct Usage {
        uint128 amountUsed;
        uint128 currentTimeWindowStartTime;
    }

    struct SpendingRule {
        Rule rule;
        Usage usage;
    }

    struct Session {
        address agent;
        SpendingRule[] spendingRules;
    }

    struct SessionManagerStorage {
        mapping(bytes32 => Session) sessions;
        // Supported stablecoins whitelist
        mapping(address => bool) supportedTokens;
        mapping(address => uint8) tokenDecimals;
        // Master budget rules (reuses SpendingRule, targetProviders is always empty)
        SpendingRule[] masterBudgetRules;
        // Nonce tracking for replay protection
        mapping(bytes32 => bool) usedNonces;
    }

    // keccak256(abi.encode(uint256(keccak256("gokite.storage.SessionManager")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _sessionManagerStorageLocation =
        0x54f3cd7f1dcf2170d37a5ed24df0875d041be47f2f40a367eaf8875cb42b8c00;

    uint256 private constant _maxSpendingRuleLength = 20;
    uint256 private constant _maxProviderLength = 10;
    uint256 private constant _maxMasterBudgetRuleLength = 10;

    // Events
    event SessionCreated(bytes32 indexed sessionId, address agent);
    event SessionRemoved(bytes32 indexed sessionId);
    event SessionAgentUpdated(bytes32 indexed sessionId, address agent);
    event SpendingRuleAdded(
        bytes32 indexed sessionId,
        uint256 timeWindow,
        uint160 budget,
        uint96 initialWindowStartTime,
        bytes32[] targetProviders
    );
    event SpendingRuleRemoved(
        bytes32 indexed sessionId,
        uint256 timeWindow,
        uint160 budget,
        uint96 initialWindowStartTime,
        bytes32[] targetProviders
    );
    event SpendingRulesCleared(bytes32 indexed sessionId);
    event UsageUpdated(
        bytes32 indexed sessionId,
        uint256 amountUsed,
        uint256 currentTimeWindowStartTime,
        uint256 chargedAmount
    );
    event SupportedTokenAdded(address indexed token, uint8 decimals);
    event SupportedTokenRemoved(address indexed token);
    event MasterBudgetRuleAdded(uint256 timeWindow, uint160 budget);
    event MasterBudgetRuleRemoved(uint256 timeWindow, uint160 budget);
    event MasterBudgetRulesCleared();
    event MasterBudgetUsageUpdated(
        uint256 indexed ruleIndex,
        uint256 amountUsed,
        uint256 chargedAmount
    );
    event TransferExecuted(
        bytes32 indexed sessionId,
        address indexed token,
        address indexed to,
        uint256 amount,
        bytes32 nonce,
        bytes metadata
    );

    // Errors
    error InvalidIndex();
    error InvalidToken();
    error InvalidSessionId();
    error SessionAlreadyExists(bytes32 sessionId);
    error SessionNotFound(bytes32 sessionId);
    error InsufficientBalance();
    error SpendingRuleNotPassed();
    error MaxSpendingRuleLengthExceeded();
    error MaxProviderLengthExceeded();
    error InvalidWindowStartTime();
    error NotSessionAdmin(address caller);
    error InvalidBudget();
    error InvalidAgent();
    error TokenNotSupported(address token);
    error TokenAlreadySupported(address token);
    error MasterBudgetExceeded();
    error NonceAlreadyUsed(bytes32 nonce);
    error MaxMasterBudgetRuleLengthExceeded();

    modifier onlySessionAdmin() {
        if (!_isSessionAdmin(msg.sender)) {
            revert NotSessionAdmin(msg.sender);
        }
        _;
    }

    // ============ Session Management ============

    /**
     * @notice Create a new session with an agent.
     * @param sessionId Unique identifier for the session
     * @param agent The EOA address that controls this session
     * @param rules Initial spending rules for the session
     */
    function createSession(
        bytes32 sessionId,
        address agent,
        Rule[] calldata rules
    ) external onlySessionAdmin {
        if (sessionId == bytes32(0)) revert InvalidSessionId();
        if (agent == address(0)) revert InvalidAgent();
        if (rules.length > _maxSpendingRuleLength) {
            revert MaxSpendingRuleLengthExceeded();
        }

        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = $.sessions[sessionId];
        if (session.agent != address(0)) revert SessionAlreadyExists(sessionId);

        session.agent = agent;

        for (uint256 i = 0; i < rules.length; i++) {
            _addSpendingRule(sessionId, session, rules[i]);
        }

        emit SessionCreated(sessionId, agent);
    }

    /**
     * @notice Remove an existing session and its rules.
     */
    function removeSession(bytes32 sessionId) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        _getSession($, sessionId);
        delete $.sessions[sessionId];

        emit SessionRemoved(sessionId);
    }

    /**
     * @notice Update the agent for a session.
     */
    function setSessionAgent(
        bytes32 sessionId,
        address agent
    ) external onlySessionAdmin {
        if (agent == address(0)) revert InvalidAgent();
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);
        session.agent = agent;
        emit SessionAgentUpdated(sessionId, agent);
    }

    /**
     * @notice Get the agent address for a session.
     */
    function getSessionAgent(bytes32 sessionId) public view returns (address) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);
        return session.agent;
    }

    /**
     * @notice Check if a session exists.
     */
    function sessionExists(bytes32 sessionId) public view returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        return $.sessions[sessionId].agent != address(0);
    }

    // ============ Token Whitelist Management ============

    /**
     * @notice Add a supported stablecoin token.
     * @param token The token address to add
     */
    function addSupportedToken(address token) external onlySessionAdmin {
        if (token == address(0)) revert InvalidToken();
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if ($.supportedTokens[token]) revert TokenAlreadySupported(token);

        uint8 decimals = IERC20Metadata(token).decimals();
        $.supportedTokens[token] = true;
        $.tokenDecimals[token] = decimals;

        emit SupportedTokenAdded(token, decimals);
    }

    /**
     * @notice Remove a supported stablecoin token.
     * @param token The token address to remove
     */
    function removeSupportedToken(address token) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if (!$.supportedTokens[token]) revert TokenNotSupported(token);

        $.supportedTokens[token] = false;
        delete $.tokenDecimals[token];

        emit SupportedTokenRemoved(token);
    }

    /**
     * @notice Check if a token is supported.
     */
    function isTokenSupported(address token) public view returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        return $.supportedTokens[token];
    }

    /**
     * @notice Get decimals for a supported token.
     */
    function getTokenDecimals(address token) public view returns (uint8) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if (!$.supportedTokens[token]) revert TokenNotSupported(token);
        return $.tokenDecimals[token];
    }

    // ============ Master Budget Management ============

    /**
     * @notice Add a master budget rule (reuses SpendingRule structure).
     * @param timeWindow Time window in seconds. 0 = per transaction limit
     * @param budget Budget limit for the time window (in standard 18 decimals, max uint160)
     *
     * Examples:
     * - Per transaction: timeWindow = 0, budget = 100 USD
     * - Per day: timeWindow = 86400, budget = 1000 USD
     * - Per week: timeWindow = 604800, budget = 5000 USD
     */
    function addMasterBudgetRule(
        uint256 timeWindow,
        uint160 budget
    ) external onlySessionAdmin {
        if (budget == 0) revert InvalidBudget();
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if ($.masterBudgetRules.length >= _maxMasterBudgetRuleLength) {
            revert MaxMasterBudgetRuleLengthExceeded();
        }

        uint128 windowStartTime = timeWindow > 0 ? uint128(block.timestamp) : 0;

        $.masterBudgetRules.push(
            SpendingRule({
                rule: Rule({
                    timeWindow: timeWindow,
                    budget: budget,
                    initialWindowStartTime: uint96(block.timestamp),
                    targetProviders: new bytes32[](0) // Empty for master budget
                }),
                usage: Usage({
                    amountUsed: 0,
                    currentTimeWindowStartTime: windowStartTime
                })
            })
        );

        emit MasterBudgetRuleAdded(timeWindow, budget);
    }

    /**
     * @notice Remove a master budget rule by index.
     * @param index The index of the rule to remove
     */
    function removeMasterBudgetRule(uint256 index) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if (index >= $.masterBudgetRules.length) revert InvalidIndex();

        SpendingRule memory removedRule = $.masterBudgetRules[index];
        uint256 lastIndex = $.masterBudgetRules.length - 1;

        if (index != lastIndex) {
            $.masterBudgetRules[index] = $.masterBudgetRules[lastIndex];
        }
        $.masterBudgetRules.pop();

        emit MasterBudgetRuleRemoved(
            removedRule.rule.timeWindow,
            removedRule.rule.budget
        );
    }

    /**
     * @notice Set all master budget rules at once (replaces existing rules).
     * @param timeWindows Array of time windows (0 = per transaction)
     * @param budgets Array of budget limits
     */
    function setMasterBudgetRules(
        uint256[] calldata timeWindows,
        uint160[] calldata budgets
    ) external onlySessionAdmin {
        if (timeWindows.length != budgets.length) revert InvalidIndex();
        if (timeWindows.length > _maxMasterBudgetRuleLength) {
            revert MaxMasterBudgetRuleLengthExceeded();
        }

        SessionManagerStorage storage $ = _getSessionManagerStorage();

        // Clear existing rules
        delete $.masterBudgetRules;
        emit MasterBudgetRulesCleared();

        // Add new rules
        for (uint256 i = 0; i < timeWindows.length; i++) {
            if (budgets[i] == 0) revert InvalidBudget();

            uint128 windowStartTime = timeWindows[i] > 0
                ? uint128(block.timestamp)
                : 0;

            $.masterBudgetRules.push(
                SpendingRule({
                    rule: Rule({
                        timeWindow: timeWindows[i],
                        budget: budgets[i],
                        initialWindowStartTime: uint96(block.timestamp),
                        targetProviders: new bytes32[](0)
                    }),
                    usage: Usage({
                        amountUsed: 0,
                        currentTimeWindowStartTime: windowStartTime
                    })
                })
            );
            emit MasterBudgetRuleAdded(timeWindows[i], budgets[i]);
        }
    }

    /**
     * @notice Clear all master budget rules.
     */
    function clearMasterBudgetRules() external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        delete $.masterBudgetRules;
        emit MasterBudgetRulesCleared();
    }

    /**
     * @notice Get all master budget rules with current usage.
     * @return rules Array of master budget rules (as SpendingRule)
     */
    function getMasterBudgetRules()
        external
        view
        returns (SpendingRule[] memory rules)
    {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        rules = new SpendingRule[]($.masterBudgetRules.length);

        for (uint256 i = 0; i < $.masterBudgetRules.length; i++) {
            rules[i] = $.masterBudgetRules[i];
            // Adjust usage based on time window
            if (rules[i].rule.timeWindow > 0) {
                if (
                    block.timestamp -
                        rules[i].usage.currentTimeWindowStartTime >
                    rules[i].rule.timeWindow
                ) {
                    rules[i].usage.amountUsed = 0;
                }
            }
        }
        return rules;
    }

    /**
     * @notice Get the number of master budget rules.
     */
    function getMasterBudgetRuleCount() external view returns (uint256) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        return $.masterBudgetRules.length;
    }

    // ============ Nonce Management ============

    /**
     * @notice Check if a nonce has been used.
     */
    function isNonceUsed(bytes32 nonce) public view returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        return $.usedNonces[nonce];
    }

    // ============ Spending Rules Management ============

    /**
     * @notice Configure spending rules for a session.
     */
    function configureSpendingRule(
        bytes32 sessionId,
        uint256[] calldata indicesToRemove,
        Rule[] calldata rulesToAdd
    ) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);

        uint256 finalLength = session.spendingRules.length -
            indicesToRemove.length +
            rulesToAdd.length;
        if (finalLength > _maxSpendingRuleLength) {
            revert MaxSpendingRuleLengthExceeded();
        }

        uint256[] memory sortedIndices = _sortIndicesDescending(
            indicesToRemove
        );

        for (uint256 i = 0; i < sortedIndices.length; i++) {
            _removeSpendingRule(sessionId, session, sortedIndices[i]);
        }

        for (uint256 i = 0; i < rulesToAdd.length; i++) {
            _addSpendingRule(sessionId, session, rulesToAdd[i]);
        }
    }

    /**
     * @notice Replace all session spending rules.
     */
    function setSpendingRules(
        bytes32 sessionId,
        Rule[] calldata rules
    ) external onlySessionAdmin {
        if (rules.length > _maxSpendingRuleLength) {
            revert MaxSpendingRuleLengthExceeded();
        }

        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);

        _clearSpendingRules(sessionId, session);
        for (uint256 i = 0; i < rules.length; i++) {
            _addSpendingRule(sessionId, session, rules[i]);
        }
    }

    /**
     * @notice Append new spending rules to a session.
     */
    function addSpendingRules(
        bytes32 sessionId,
        Rule[] calldata rules
    ) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);

        if (
            session.spendingRules.length + rules.length > _maxSpendingRuleLength
        ) {
            revert MaxSpendingRuleLengthExceeded();
        }

        for (uint256 i = 0; i < rules.length; i++) {
            _addSpendingRule(sessionId, session, rules[i]);
        }
    }

    /**
     * @notice Remove specified spending rules by index.
     */
    function removeSpendingRules(
        bytes32 sessionId,
        uint256[] calldata indices
    ) external onlySessionAdmin {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);

        uint256[] memory sortedIndices = _sortIndicesDescending(indices);
        for (uint256 i = 0; i < sortedIndices.length; i++) {
            _removeSpendingRule(sessionId, session, sortedIndices[i]);
        }
    }

    /**
     * @notice Return the spending rules configured for a session.
     */
    function getSpendingRules(
        bytes32 sessionId
    ) external view returns (SpendingRule[] memory) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);

        SpendingRule[] memory spendingRules = session.spendingRules;
        for (uint256 i = 0; i < spendingRules.length; i++) {
            spendingRules[i].usage.amountUsed = _getUsage(session, i);
        }
        return spendingRules;
    }

    /**
     * @notice Return usage for a specific spending rule.
     */
    function getUsage(
        bytes32 sessionId,
        uint256 index
    ) external view returns (uint256) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);
        return _getUsage(session, index);
    }

    /**
     * @notice Check whether an amount would satisfy the session spending rules (view only).
     * @param sessionId The session to check
     * @param normalizedAmount The amount in standard decimals (18)
     * @param serviceProvider The service provider identifier
     */
    function checkSpendingRules(
        bytes32 sessionId,
        uint256 normalizedAmount,
        bytes32 serviceProvider
    ) external view returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);
        return
            _checkSpendingRulesView(session, normalizedAmount, serviceProvider);
    }

    /**
     * @notice Return the available balance of the specified token held by this contract.
     */
    function getAvailableBalance(
        address token
    ) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ============ Internal Functions ============

    /**
     * @dev Implemented by inheriting contracts to authorize administrative actions.
     */
    function _isSessionAdmin(
        address caller
    ) internal view virtual returns (bool);

    function _getSessionManagerStorage()
        internal
        pure
        returns (SessionManagerStorage storage $)
    {
        bytes32 location = _sessionManagerStorageLocation;
        assembly {
            $.slot := location
        }
    }

    function _getSession(
        SessionManagerStorage storage $,
        bytes32 sessionId
    ) internal view returns (Session storage session) {
        session = $.sessions[sessionId];
        if (session.agent == address(0)) revert SessionNotFound(sessionId);
    }

    /**
     * @notice Normalize token amount to standard 18 decimals.
     */
    function _normalizeAmount(
        address token,
        uint256 amount
    ) internal view returns (uint256) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        uint8 decimals = $.tokenDecimals[token];
        if (decimals < STANDARD_DECIMALS) {
            return amount * (10 ** (STANDARD_DECIMALS - decimals));
        } else if (decimals > STANDARD_DECIMALS) {
            return amount / (10 ** (decimals - STANDARD_DECIMALS));
        }
        return amount;
    }

    /**
     * @notice Check if amount is within all master budget rules.
     */
    function _checkMasterBudget(
        uint256 normalizedAmount
    ) internal view returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();

        // If no rules, allow all
        if ($.masterBudgetRules.length == 0) return true;

        for (uint256 i = 0; i < $.masterBudgetRules.length; i++) {
            if (!_checkUsage($.masterBudgetRules[i], normalizedAmount)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Update all master budget rules with the spent amount.
     */
    function _updateMasterBudgetUsage(uint256 normalizedAmount) internal {
        SessionManagerStorage storage $ = _getSessionManagerStorage();

        for (uint256 i = 0; i < $.masterBudgetRules.length; i++) {
            _updateMasterBudgetRule(
                i,
                $.masterBudgetRules[i],
                normalizedAmount
            );
        }
    }

    /**
     * @notice Update a single master budget rule.
     */
    function _updateMasterBudgetRule(
        uint256 index,
        SpendingRule storage spendingRule,
        uint256 amount
    ) internal {
        // Per transaction limit doesn't accumulate
        if (spendingRule.rule.timeWindow == 0) {
            return;
        }

        // Check if window has expired and reset
        if (
            block.timestamp - spendingRule.usage.currentTimeWindowStartTime >
            spendingRule.rule.timeWindow
        ) {
            spendingRule.usage.amountUsed = 0;
            uint128 windowPassed = uint128(
                block.timestamp - spendingRule.usage.currentTimeWindowStartTime
            ) / uint128(spendingRule.rule.timeWindow);
            spendingRule.usage.currentTimeWindowStartTime +=
                windowPassed *
                uint128(spendingRule.rule.timeWindow);
        }

        spendingRule.usage.amountUsed += uint128(amount);
        emit MasterBudgetUsageUpdated(
            index,
            spendingRule.usage.amountUsed,
            amount
        );
    }

    /**
     * @notice Mark a nonce as used.
     */
    function _markNonceUsed(bytes32 nonce) internal {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if ($.usedNonces[nonce]) revert NonceAlreadyUsed(nonce);
        $.usedNonces[nonce] = true;
    }

    /**
     * @notice Validate token is supported.
     */
    function _validateToken(address token) internal view {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        if (!$.supportedTokens[token]) revert TokenNotSupported(token);
    }

    /**
     * @notice Check spending rules and update usage.
     */
    function _checkAndUpdateSpendingRules(
        bytes32 sessionId,
        uint256 normalizedAmount,
        bytes32 serviceProvider
    ) internal returns (bool) {
        SessionManagerStorage storage $ = _getSessionManagerStorage();
        Session storage session = _getSession($, sessionId);
        return
            _checkSpendingRules(
                sessionId,
                session,
                normalizedAmount,
                serviceProvider
            );
    }

    function _addSpendingRule(
        bytes32 sessionId,
        Session storage session,
        Rule calldata rule
    ) internal {
        if (rule.initialWindowStartTime > block.timestamp) {
            revert InvalidWindowStartTime();
        }
        if (rule.targetProviders.length > _maxProviderLength) {
            revert MaxProviderLengthExceeded();
        }
        if (rule.budget > type(uint128).max) {
            revert InvalidBudget();
        }

        uint128 currentTimeWindowStartTime = rule.timeWindow > 0
            ? rule.initialWindowStartTime
            : 0;

        session.spendingRules.push(
            SpendingRule({
                rule: rule,
                usage: Usage({
                    currentTimeWindowStartTime: currentTimeWindowStartTime,
                    amountUsed: 0
                })
            })
        );

        emit SpendingRuleAdded(
            sessionId,
            rule.timeWindow,
            rule.budget,
            rule.initialWindowStartTime,
            rule.targetProviders
        );
    }

    function _removeSpendingRule(
        bytes32 sessionId,
        Session storage session,
        uint256 index
    ) internal {
        if (index >= session.spendingRules.length) revert InvalidIndex();

        SpendingRule memory removedRule = session.spendingRules[index];
        uint256 lastIndex = session.spendingRules.length - 1;

        if (index != lastIndex) {
            session.spendingRules[index] = session.spendingRules[lastIndex];
        }
        session.spendingRules.pop();

        emit SpendingRuleRemoved(
            sessionId,
            removedRule.rule.timeWindow,
            removedRule.rule.budget,
            removedRule.rule.initialWindowStartTime,
            removedRule.rule.targetProviders
        );
    }

    function _clearSpendingRules(
        bytes32 sessionId,
        Session storage session
    ) internal {
        delete session.spendingRules;
        emit SpendingRulesCleared(sessionId);
    }

    function _getUsage(
        Session storage session,
        uint256 index
    ) internal view returns (uint128) {
        if (index >= session.spendingRules.length) revert InvalidIndex();
        SpendingRule storage spendingRule = session.spendingRules[index];

        if (
            spendingRule.usage.currentTimeWindowStartTime +
                spendingRule.rule.timeWindow <
            block.timestamp
        ) {
            return 0;
        }

        return spendingRule.usage.amountUsed;
    }

    function _checkSpendingRules(
        bytes32 sessionId,
        Session storage session,
        uint256 amount,
        bytes32 serviceProvider
    ) internal returns (bool) {
        for (uint256 i = 0; i < session.spendingRules.length; i++) {
            if (
                !_checkSpendingRule(
                    amount,
                    serviceProvider,
                    session.spendingRules[i]
                )
            ) {
                return false;
            }
        }

        for (uint256 i = 0; i < session.spendingRules.length; i++) {
            _updateSpendingRule(
                sessionId,
                amount,
                serviceProvider,
                session.spendingRules[i]
            );
        }

        return true;
    }

    function _checkSpendingRulesView(
        Session storage session,
        uint256 amount,
        bytes32 serviceProvider
    ) internal view returns (bool) {
        for (uint256 i = 0; i < session.spendingRules.length; i++) {
            if (
                !_checkSpendingRule(
                    amount,
                    serviceProvider,
                    session.spendingRules[i]
                )
            ) {
                return false;
            }
        }
        return true;
    }

    function _isApplicable(
        SpendingRule storage spendingRule,
        bytes32 serviceProvider
    ) internal view returns (bool) {
        if (spendingRule.rule.targetProviders.length == 0) return true;
        for (uint256 i = 0; i < spendingRule.rule.targetProviders.length; i++) {
            if (spendingRule.rule.targetProviders[i] == serviceProvider) {
                return true;
            }
        }
        return false;
    }

    function _checkUsage(
        SpendingRule storage spendingRule,
        uint256 amount
    ) internal view returns (bool) {
        if (spendingRule.rule.timeWindow == 0) {
            return spendingRule.rule.budget >= amount;
        }

        uint128 currentUsage = spendingRule.usage.amountUsed;

        if (
            block.timestamp - spendingRule.usage.currentTimeWindowStartTime >
            spendingRule.rule.timeWindow
        ) {
            currentUsage = 0;
        }

        return currentUsage + amount <= spendingRule.rule.budget;
    }

    function _checkSpendingRule(
        uint256 amount,
        bytes32 serviceProvider,
        SpendingRule storage spendingRule
    ) internal view returns (bool) {
        if (!_isApplicable(spendingRule, serviceProvider)) return true;
        return _checkUsage(spendingRule, amount);
    }

    function _updateSpendingRule(
        bytes32 sessionId,
        uint256 amount,
        bytes32 serviceProvider,
        SpendingRule storage spendingRule
    ) internal {
        if (!_isApplicable(spendingRule, serviceProvider)) {
            return;
        }

        if (spendingRule.rule.timeWindow == 0) {
            return;
        }

        if (
            block.timestamp - spendingRule.usage.currentTimeWindowStartTime >
            spendingRule.rule.timeWindow
        ) {
            spendingRule.usage.amountUsed = 0;
            uint128 windowPassed = uint128(
                block.timestamp - spendingRule.usage.currentTimeWindowStartTime
            ) / uint128(spendingRule.rule.timeWindow);
            spendingRule.usage.currentTimeWindowStartTime +=
                windowPassed *
                uint128(spendingRule.rule.timeWindow);
        }

        spendingRule.usage.amountUsed += uint128(amount);
        emit UsageUpdated(
            sessionId,
            spendingRule.usage.amountUsed,
            spendingRule.usage.currentTimeWindowStartTime,
            amount
        );
    }

    function _sortIndicesDescending(
        uint256[] calldata indices
    ) internal pure returns (uint256[] memory) {
        if (indices.length == 0) {
            return new uint256[](0);
        }

        uint256[] memory sortedIndices = new uint256[](indices.length);
        for (uint256 i = 0; i < indices.length; i++) {
            sortedIndices[i] = indices[i];
        }

        for (uint256 i = 0; i < sortedIndices.length; i++) {
            for (uint256 j = 0; j < sortedIndices.length - 1 - i; j++) {
                if (sortedIndices[j] == sortedIndices[j + 1]) {
                    revert InvalidIndex();
                }
                if (sortedIndices[j] < sortedIndices[j + 1]) {
                    uint256 temp = sortedIndices[j];
                    sortedIndices[j] = sortedIndices[j + 1];
                    sortedIndices[j + 1] = temp;
                }
            }
        }

        return sortedIndices;
    }
}
