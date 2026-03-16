import React, { useCallback, useEffect, useState } from 'react'

interface RepoViewProps {
  repoPath: string
  onCloseRepo: () => void
}

interface BranchInfo {
  name: string
  current: boolean
}

interface RepoStatus {
  branch: string
  staged: number
  unstaged: number
  untracked: number
}

export function RepoView({ repoPath, onCloseRepo }: RepoViewProps): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadRepoData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Load status
      const statusResult = await window.electronAPI.git.getStatus(repoPath)
      if (statusResult.success && statusResult.data) {
        const data = statusResult.data
        setStatus({
          branch: data.branch?.head || 'unknown',
          staged: Array.isArray(data.staged) ? data.staged.length : 0,
          unstaged: Array.isArray(data.unstaged) ? data.unstaged.length : 0,
          untracked: Array.isArray(data.untracked) ? data.untracked.length : 0
        })
      }

      // Load branches
      const branchResult = await window.electronAPI.git.getBranches(repoPath)
      if (branchResult.success && Array.isArray(branchResult.data)) {
        setBranches(
          branchResult.data.map((b: { name: string; current: boolean }) => ({
            name: b.name,
            current: b.current
          }))
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository data')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    loadRepoData()
  }, [loadRepoData])

  const repoName = repoPath.split(/[/\\]/).pop() || repoPath
  const currentBranch = branches.find((b) => b.current)?.name || status?.branch || '—'

  return (
    <div className="repo-view">
      <div className="repo-view-header">
        <div className="repo-view-info">
          <h2 className="repo-view-name">{repoName}</h2>
          <span className="repo-view-path" title={repoPath}>
            {repoPath}
          </span>
        </div>
        <div className="repo-view-actions">
          <button className="repo-view-refresh" onClick={loadRepoData} title="Refresh">
            &#x21BB;
          </button>
          <button className="repo-view-close" onClick={onCloseRepo} title="Close repository">
            &#x2715; Close
          </button>
        </div>
      </div>

      {loading && (
        <div className="repo-view-loading">
          <span className="repo-view-spinner">&#x21BB;</span>
          Loading repository...
        </div>
      )}

      {error && (
        <div className="repo-view-error">
          <span>&#9888;</span> {error}
          <button onClick={loadRepoData}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className="repo-view-content">
          <div className="repo-view-summary">
            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9739;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Current Branch</span>
                <span className="repo-view-card-value">{currentBranch}</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9998;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Staged</span>
                <span className="repo-view-card-value">{status?.staged ?? 0} files</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9997;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Unstaged</span>
                <span className="repo-view-card-value">{status?.unstaged ?? 0} files</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#63;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Untracked</span>
                <span className="repo-view-card-value">{status?.untracked ?? 0} files</span>
              </div>
            </div>
          </div>

          {branches.length > 0 && (
            <div className="repo-view-branches">
              <h3>Branches ({branches.length})</h3>
              <ul className="repo-view-branch-list">
                {branches.map((branch) => (
                  <li
                    key={branch.name}
                    className={`repo-view-branch-item${branch.current ? ' repo-view-branch-current' : ''}`}
                  >
                    {branch.current && <span className="repo-view-branch-indicator">&#x25CF;</span>}
                    {branch.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
