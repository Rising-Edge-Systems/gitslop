import React from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'

function App(): React.JSX.Element {
  return (
    <div className="app">
      <TitleBar />
      <AppLayout />
    </div>
  )
}

export default App
