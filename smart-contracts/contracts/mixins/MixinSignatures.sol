pragma solidity 0.5.16;

import '../UnlockUtils.sol';
import './MixinLockCore.sol';


contract MixinSignatures is
  MixinLockCore
{
  using UnlockUtils for uint;

  /// @notice emits anytime the nonce used for off-chain approvals changes.
  event NonceChanged(
    address indexed keyOwner,
    uint nextAvailableNonce
  );

  // Stores a nonce per user to use for signed messages
  mapping(address => uint) public keyOwnerToNonce;

  // EIP-712
  bytes32 private constant EIP712DOMAIN_TYPEHASH = keccak256(
    'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
  );
  /// @notice the separator used for signing messages
  /// @dev from EIP-712
  bytes32 public DOMAIN_SEPARATOR;

  function getChainId(
  ) private pure
    returns (uint id)
  {
    // solium-disable-next-line
    assembly
    {
      id := chainid()
    }
  }

  function _initializeMixinSignatures(
  ) internal
  {
    DOMAIN_SEPARATOR = keccak256(
      abi.encode(
        EIP712DOMAIN_TYPEHASH,
        keccak256(bytes('PublicLock')),
        keccak256(bytes(publicLockVersion().uint2Str())),
        getChainId(),
        address(this)
      )
    );
  }

  /// @notice Validates an off-chain approval signature.
  /// @dev If valid the nonce is consumed, else revert.
  /// Follows EIP-712
  /// @param _hash must include the account's keyOwnerToNonce value
  function _consumeOffchainApproval(
    address _signingAccount,
    bytes32 _hash,
    uint8 _v,
    bytes32 _r,
    bytes32 _s
  ) internal
  {
    require(
      ecrecover(
        keccak256(
          abi.encodePacked(
            // Prefix as per EIP-712
            '\x19\x01',
            DOMAIN_SEPARATOR,
            _hash
          )
        ),
        _v,
        _r,
        _s
      ) == _signingAccount, 'INVALID_SIGNATURE'
    );
    keyOwnerToNonce[_signingAccount]++;
    emit NonceChanged(_signingAccount, keyOwnerToNonce[_signingAccount]);
  }

  /**
   * @notice Sets the minimum nonce for a valid off-chain approval message from the
   * senders account.
   * @dev This can be used to invalidate a previously signed message.
   */
  function invalidateOffchainApproval(
    uint _nextAvailableNonce
  ) external
  {
    require(_nextAvailableNonce > keyOwnerToNonce[msg.sender], 'NONCE_ALREADY_USED');
    keyOwnerToNonce[msg.sender] = _nextAvailableNonce;
    emit NonceChanged(msg.sender, _nextAvailableNonce);
  }
}