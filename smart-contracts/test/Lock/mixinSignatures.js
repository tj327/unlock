const deployLocks = require('../helpers/deployLocks')

const unlockContract = artifacts.require('../Unlock.sol')
const getProxy = require('../helpers/proxy')

contract('Lock / mixinSignatures', accounts => {
  let lock

  before(async () => {
    const unlock = await getProxy(unlockContract)
    const locks = await deployLocks(unlock, accounts[0])
    lock = locks.FIRST
  })

  it('has the correct DOMAIN_SEPARATOR', async () => {
    const domainSeparator = await lock.DOMAIN_SEPARATOR()
    const expectedDomainSeparator = web3.utils.keccak256(
      web3.eth.abi.encodeParameters(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [
          web3.utils.keccak256(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
          ),
          web3.utils.keccak256('PublicLock'),
          web3.utils.keccak256((await lock.publicLockVersion()).toString()),
          // Ganache chainId bug: https://github.com/trufflesuite/ganache-core/issues/515
          '1',
          lock.address,
        ]
      )
    )
    assert.equal(domainSeparator, expectedDomainSeparator)
  })
})
