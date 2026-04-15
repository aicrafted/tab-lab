import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { registerDebugApi } from '@/lib/debug-api'
import '../../globals.css'

registerDebugApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
