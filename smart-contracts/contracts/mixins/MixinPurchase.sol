pragma solidity 0.5.14;

import './MixinDisableAndDestroy.sol';
import './MixinKeys.sol';
import './MixinLockCore.sol';
import '@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol';
import './MixinFunds.sol';
import './MixinEventHooks.sol';


/**
 * @title Mixin for the purchase-related functions.
 * @author HardlyDifficult
 * @dev `Mixins` are a design pattern seen in the 0x contracts.  It simply
 * separates logically groupings of code to ease readability.
 */
contract MixinPurchase is
  MixinFunds,
  MixinDisableAndDestroy,
  MixinLockCore,
  MixinKeys,
  MixinEventHooks
{
  using SafeMath for uint;

  /**
  * @dev Purchase function
  * @param _value the number of tokens to pay for this purchase >= the current keyPrice - any applicable discount
  * (_value is ignored when using ETH)
  * @param _recipient address of the recipient of the purchased key
  * @param _referrer address of the user making the referral
  * @param _data arbitrary data populated by the front-end which initiated the sale
  * @dev Setting _value to keyPrice exactly doubles as a security feature. That way if the lock owner increases the
  * price while my transaction is pending I can't be charged more than I expected (only applicable to ERC-20 when more
  * than keyPrice is approved for spending).
  */
  function purchase(
    uint256 _value,
    address _recipient,
    address _referrer,
    bytes calldata _data
  ) external payable
    onlyIfAlive
    notSoldOut
  {
    require(_recipient != address(0), 'INVALID_ADDRESS');

    // Assign the key
    Key storage toKey = keyByOwner[_recipient];

    if (toKey.tokenId == 0) {
      // Assign a new tokenId (if a new owner or previously transferred)
      _assignNewTokenId(toKey);
      _recordOwner(_recipient, toKey.tokenId);

      emit Transfer(
        address(0), // This is a creation.
        _recipient,
        toKey.tokenId
      );
    }

    _timeMachine(toKey.tokenId, expirationDuration, true);


    // Let's get the actual price for the key from the Unlock smart contract
    uint discount;
    uint tokens;
    uint inMemoryKeyPrice = keyPrice;
    (discount, tokens) = unlockProtocol.computeAvailableDiscountFor(_recipient, inMemoryKeyPrice);

    if (discount > inMemoryKeyPrice) {
      inMemoryKeyPrice = 0;
    } else {
      // SafeSub not required as the if statement already confirmed `inMemoryKeyPrice - discount` cannot underflow
      inMemoryKeyPrice -= discount;
    }

    if (discount > 0) {
      unlockProtocol.recordConsumedDiscount(discount, tokens);
    }

    unlockProtocol.recordKeyPurchase(inMemoryKeyPrice, getHasValidKey(_referrer) ? _referrer : address(0));

    // We explicitly allow for greater amounts of ETH or tokens to allow 'donations'
    if(tokenAddress != address(0)) {
      require(_value >= inMemoryKeyPrice, 'INSUFFICIENT_VALUE');
      inMemoryKeyPrice = _value;
    }
    // Security: after state changes to minimize risk of re-entrancy
    uint pricePaid = _chargeAtLeast(inMemoryKeyPrice);

    // Security: last line to minimize risk of re-entrancy
    _onKeySold(_recipient, _referrer, pricePaid, _data);
  }
}
