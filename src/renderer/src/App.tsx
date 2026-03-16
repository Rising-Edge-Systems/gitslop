import React from 'react'
import { TitleBar } from './components/TitleBar'

function App(): React.JSX.Element {
  return (
    <div className="app">
      <TitleBar />
      <main className="app-content">
        <div className="welcome">
          <h1>GitSlop</h1>
          <p>A powerful, open-source Git client</p>
        </div>
      </main>
    </div>
  )
}

export default App
