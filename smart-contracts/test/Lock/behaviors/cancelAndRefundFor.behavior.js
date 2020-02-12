const sigUtil = require('eth-sig-util')
const BigNumber = require('bignumber.js')
const { eventEmitted, reverts } = require('truffle-assertions')

const testAccount = web3.eth.accounts.privateKeyToAccount(
  web3.utils.keccak256('cow')
)

// signs message
async function signMessage(messageHex, from) {
  const signature = sigUtil.signTypedData(
    // TODO
    Buffer.from(testAccount.privateKey.substr(2), 'hex'),
    { data: messageHex }
  )
  console.log(signature)
  const v = `0x${signature.slice(130, 132)}`
  const r = signature.slice(0, 66)
  const s = `0x${signature.slice(66, 130)}`
  return { v, r, s }
}

module.exports.cancelAndRefundFor = options => {
  describe.only('Lock / cancelAndRefundFor', () => {
    let accounts
    let lock
    let keyOwners
    let txSender
    let lockOwner
    let keyPrice

    beforeEach(async () => {
      ;({ accounts, lock } = options)
      keyOwners = [accounts[1], accounts[2], accounts[3], accounts[4]]
      txSender = accounts[9]
      keyPrice = new BigNumber(await lock.keyPrice())

      const purchases = keyOwners.map(account => {
        return lock.purchase(
          keyPrice.toFixed(),
          account,
          web3.utils.padLeft(0, 40),
          [],
          {
            value: lock.isErc20 ? 0 : keyPrice.toFixed(),
            from: account,
          }
        )
      })
      await Promise.all(purchases)
      lockOwner = await lock.owner.call()
    })

    it('can read the current nonce', async () => {
      const nonce = new BigNumber(await lock.keyOwnerToNonce.call(keyOwners[0]))
      assert.equal(nonce.toFixed(), 0)
    })

    it('can increment nonce', async () => {
      await lock.invalidateOffchainApproval('1', { from: keyOwners[0] })
    })

    it('has the expected typehash', async () => {
      const typehash = await lock.CANCEL_TYPEHASH()
      const expected = web3.utils.keccak256(
        'cancelAndRefundFor(address _keyOwner)'
      )
      assert.equal(typehash, expected)
    })

    describe('should cancel and refund when enough time remains', () => {
      let initialLockBalance
      let initialTxSenderBalance
      let txObj
      let withdrawAmount

      beforeEach(async () => {
        initialLockBalance = new BigNumber(
          await web3.eth.getBalance(lock.address)
        )
        initialTxSenderBalance = new BigNumber(
          await web3.eth.getBalance(txSender)
        )
        const msgParams = {
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            CancelAndRefundFor: [{ name: 'nonce', type: 'uint256' }],
          },
          primaryType: 'CancelAndRefundFor',
          domain: {
            name: 'PublicLock',
            version: web3.utils.keccak256(
              (await lock.publicLockVersion()).toString()
            ),
            // Ganache chainId bug: https://github.com/trufflesuite/ganache-core/issues/515
            chainId: '1',
            verifyingContract: lock.address,
          },
          message: {
            nonce: (await lock.keyOwnerToNonce(keyOwners[0])).toString(),
          },
        }
        console.log(msgParams)
        const signature = await signMessage(msgParams, keyOwners[0])
        txObj = await lock.cancelAndRefundFor(
          testAccount.address,
          signature.v,
          signature.r,
          signature.s,
          {
            from: txSender,
          }
        )
        withdrawAmount = new BigNumber(initialLockBalance).minus(
          await web3.eth.getBalance(lock.address)
        )
      })

      it.only('the amount of refund should be greater than 0', async () => {
        eventEmitted(txObj, 'CancelKey', e => {
          const refund = new BigNumber(e.refund)
          return refund.gt(0) && refund.toFixed() === withdrawAmount.toFixed()
        })
      })

      it('should make the key no longer valid (i.e. expired)', async () => {
        const isValid = await lock.getHasValidKey.call(keyOwners[0])
        assert.equal(isValid, false)
      })

      it('can read the non-zero nonce', async () => {
        const nonce = new BigNumber(
          await lock.keyOwnerToNonce.call(keyOwners[0])
        )
        assert.equal(nonce.toFixed(), 1)
      })

      it("should increase the sender's balance with the amount of funds withdrawn from the lock", async () => {
        const txHash = await web3.eth.getTransaction(txObj.tx)
        const gasUsed = new BigNumber(txObj.receipt.gasUsed)
        const gasPrice = new BigNumber(txHash.gasPrice)
        const txFee = gasPrice.times(gasUsed)
        const finalTxSenderBalance = new BigNumber(
          await web3.eth.getBalance(txSender)
        )
        assert(
          finalTxSenderBalance.toFixed(),
          initialTxSenderBalance
            .plus(withdrawAmount)
            .minus(txFee)
            .toFixed()
        )
      })

      it('emits NonceChanged', async () => {
        const e = txObj.receipt.logs.find(e => e.event === 'NonceChanged')
        assert.equal(e.args.keyOwner, keyOwners[0])
        assert.equal(e.args.nextAvailableNonce, '1')
      })
    })

    describe('should fail when', () => {
      /**
       * This is a risk: we refund via CC but can't cancel the key because the KeyOwner
       * incremented their nonce first.
       */
      it('the user incremented their nonce after signing', async () => {
        const signature = await signMessage(
          await lock.getMessageDigest(
            await lock.getCancelAndRefundApprovalHash(keyOwners[1], txSender),
            { from: keyOwners[1] }
          ),
          keyOwners[1]
        )
        await lock.invalidateOffchainApproval('1', { from: keyOwners[1] })
        await reverts(
          lock.cancelAndRefundFor(
            keyOwners[1],
            signature.v,
            signature.r,
            signature.s,
            {
              from: txSender,
            }
          ),
          'INVALID_SIGNATURE'
        )
      })

      it('the approval is used twice', async () => {
        const signature = await signMessage(
          await lock.getMessageDigest(
            await lock.getCancelAndRefundApprovalHash(keyOwners[2], txSender),
            { from: keyOwners[2] }
          ),
          keyOwners[2]
        )
        await lock.cancelAndRefundFor(
          keyOwners[2],
          signature.v,
          signature.r,
          signature.s,
          {
            from: txSender,
          }
        )
        await lock.purchase(
          keyPrice.toFixed(),
          keyOwners[2],
          web3.utils.padLeft(0, 40),
          [],
          {
            from: keyOwners[2],
            value: lock.isErc20 ? 0 : keyPrice.toFixed(),
          }
        )
        await reverts(
          lock.cancelAndRefundFor(
            keyOwners[2],
            signature.v,
            signature.r,
            signature.s,
            {
              from: txSender,
            }
          ),
          'INVALID_SIGNATURE'
        )
      })

      it('the signature is invalid', async () => {
        let signature = await signMessage(
          await lock.getMessageDigest(
            await lock.getCancelAndRefundApprovalHash(keyOwners[3], txSender),
            { from: keyOwners[3] }
          ),
          keyOwners[3]
        )
        signature.r =
          signature.r.substr(0, 4) +
          (signature.r[4] === '0' ? '1' : '0') +
          signature.r.substr(5)
        await reverts(
          lock.cancelAndRefundFor(
            keyOwners[3],
            signature.v,
            signature.r,
            signature.s,
            {
              from: txSender,
            }
          ),
          'INVALID_SIGNATURE'
        )
      })

      /**
       * This is a risk: we refund via CC but can't cancel the key because the Lock is broke
       */
      it('should fail if the Lock owner withdraws too much funds', async () => {
        await lock.withdraw(await lock.tokenAddress.call(), 0, {
          from: lockOwner,
        })

        const message = await lock.getCancelAndRefundApprovalHash(
          keyOwners[3],
          txSender
        )
        const digest = await lock.getMessageDigest(message, {
          from: keyOwners[3],
        })
        const signature = await signMessage(digest, keyOwners[3])
        await reverts(
          lock.cancelAndRefundFor(
            keyOwners[3],
            signature.v,
            signature.r,
            signature.s,
            {
              from: txSender,
            }
          ),
          ''
        )
      })

      /**
       * This is a risk: we refund via CC but can't cancel the key because the KeyOwner
       * or Lock owner canceled the key first.
       */
      it('the key is expired', async () => {
        await lock.expireKeyFor(keyOwners[3], {
          from: lockOwner,
        })

        const signature = await signMessage(
          await lock.getMessageDigest(
            await lock.getCancelAndRefundApprovalHash(keyOwners[3], txSender),
            { from: keyOwners[3] }
          ),
          keyOwners[3]
        )
        await reverts(
          lock.cancelAndRefundFor(
            keyOwners[3],
            signature.v,
            signature.r,
            signature.s,
            {
              from: txSender,
            }
          ),
          'KEY_NOT_VALID'
        )
      })
    })
  })
}
