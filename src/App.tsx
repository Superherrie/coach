import { Component, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Today from './pages/Today'
import Plan from './pages/Plan'
import Trends from './pages/Trends'
import Coach from './pages/Coach'
import Settings from './pages/Settings'

/** a crash on one screen must not blank the whole app */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card p-6 max-w-md mx-auto mt-10 text-center">
        <p className="display text-xl mb-1">That screen didn’t load</p>
        <p className="text-sm text-muted mb-4">{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}

function Shell() {
  const { session, member, loading } = useAuth()
  if (loading) return <div className="h-full grid place-items-center text-muted">Loading…</div>
  if (!session || !member) return <Login />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Boundary><Today /></Boundary>} />
        <Route path="plan" element={<Boundary><Plan /></Boundary>} />
        <Route path="trends" element={<Boundary><Trends /></Boundary>} />
        <Route path="coach" element={<Boundary><Coach /></Boundary>} />
        <Route path="settings" element={<Boundary><Settings /></Boundary>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><HashRouter><Shell /></HashRouter></AuthProvider>
}
