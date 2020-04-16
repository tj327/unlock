import React from 'react'
import { useDispatch } from 'react-redux'
import { providerReady } from '../actions/provider'
import { waitForWallet, dismissWalletCheck } from '../actions/fullScreenModals'
import { FATAL_NOT_ENABLED_IN_PROVIDER } from '../errors'
import { setError } from '../actions/error'
import { setAccount } from '../actions/accounts'

import { Application } from '../utils/Error'

import { ConfigContext } from '../utils/withConfig'

export const Web3ProviderContext = React.createContext({
  getWeb3Provider: () => {},
  setWeb3Provider: () => {},
})

export interface EthereumWindow extends Window {
  web3: any
  ethereum: any
}
interface Web3ProviderContextType {
  getWeb3Provider: any
  setWeb3Provider: any
}

interface Config {
  env: string
  httpProvider: string
}

export const useProvider = () => {
  const config: Config = React.useContext(ConfigContext)
  const { getWeb3Provider, setWeb3Provider } = React.useContext<
    Web3ProviderContextType
  >(Web3ProviderContext)

  const dispatch = useDispatch()

  const [loading, setLoading] = React.useState(true)

  /**
   * Function which is called when the App component is rendered.
   */
  const initializeProvider = async () => {
    if (config.env === 'test') {
      // We set the provider to be the provided by the local ganache
      setWeb3Provider(`http://${config.httpProvider}:8545`)
      dispatch(providerReady())
      setLoading(false)
      return
    }

    const ethereumWindow = (window as unknown) as EthereumWindow
    let provider = null
    let account = null

    // If there is an injected provider
    if (ethereumWindow.ethereum) {
      dispatch(waitForWallet())
      try {
        // Request account access if needed
        provider = ethereumWindow.ethereum
        const accounts = await provider.enable()
        account = {
          address: accounts[0],
        }
      } catch (error) {
        dispatch(setError(Application.Fatal(FATAL_NOT_ENABLED_IN_PROVIDER)))
      }
      dispatch(dismissWalletCheck())
    } else if (ethereumWindow.web3) {
      // Legacy web3 wallet/browser (should we keep supporting?)
      provider = ethereumWindow.web3.currentProvider
      account = provider.selectedAddress
      dispatch(providerReady())
    } else {
      // Hum. No provider!
      // TODO: Let's let the user pick one up from the UI (including the unlock provider!)
    }

    if (provider) {
      setWeb3Provider(provider)
      dispatch(setAccount(account))
      dispatch(providerReady())
    }

    setLoading(false)
  }

  React.useEffect(() => {
    // Try to initalize the provider
    initializeProvider()
  }, [])

  return { provider: getWeb3Provider(), loading }
}
