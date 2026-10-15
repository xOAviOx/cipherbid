import React from 'react'
import ReactDOM from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { config } from './chain'
import App from './App'
import './style.css'
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:true}}})
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><WagmiProvider config={config}><QueryClientProvider client={queryClient}><App/></QueryClientProvider></WagmiProvider></React.StrictMode>,
)
