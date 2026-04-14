# PRD: Issues Panel in Sidebar

## Introduction

Add an Issues section to the left sidebar that displays GitHub Issues and GitLab Issues for the current repository. Users can browse open/closed issues, view issue details, and open them in the browser — all without leaving the app. Follows the same pattern as the existing Pull Requests (GitHub) and Merge Requests (GitLab) sidebar sections.

## Goals

- View GitHub Issues and GitLab Issues inline in the sidebar
- Filter between open and closed issues
- View issue details (title, body, labels, assignees, comments) in a detail overlay
- Open issues in the browser with one click
- Reuse existing authentication (GitHub accounts, GitLab accounts) — no additional login needed

## User Stories

### US-IS-001: GitHub Issues IPC handlers
**Description:** As a developer, I need main process IPC handlers for listing and fetching GitHub Issues, so the renderer can display them.

**Acceptance Criteria:**
- [ ] New IPC handler `github:listIssues` accepts (owner, repo, state?) and returns an array of issues: { number, title, state, author, authorAvatar, labels: { name, color }[], assignees: string[], createdAt, updatedAt, commentCount }
- [ ] New IPC handler `github:getIssue` accepts (owner, repo, issueNumber) and returns full issue details: { ...issue fields, body (markdown), comments: { author, authorAvatar, body, createdAt }[] }
- [ ] Both handlers use `getGitHubToken()` for authentication (the helper we already have)
- [ ] Both return `{ success: false, error: 'Not logged in to GitHub' }` when no token is available
- [ ] Uses the existing `githubApiRequest` helper for API calls
- [ ] GitHub API endpoints: GET /repos/{owner}/{repo}/issues?state={state}&per_page=50&sort=updated&direction=desc (filter out pull requests — GitHub's issues endpoint includes PRs, filter by checking `pull_request` field is absent), GET /repos/{owner}/{repo}/issues/{number} for details, GET /repos/{owner}/{repo}/issues/{number}/comments for comments
- [ ] Preload exposes `window.electronAPI.github.listIssues(owner, repo, state?)` and `window.electronAPI.github.getIssue(owner, repo, issueNumber)`
- [ ] Type definitions added to useLayoutState.ts
- [ ] Typecheck passes, existing tests pass

### US-IS-002: GitLab Issues IPC handlers
**Description:** As a developer, I need main process IPC handlers for listing and fetching GitLab Issues.

**Acceptance Criteria:**
- [ ] New IPC handler `gitlab:listIssues` accepts (projectPath, state?, instanceUrl?) and returns an array of issues: { iid, title, state, author, authorAvatar, labels: { name, color }[], assignees: string[], createdAt, updatedAt, commentCount }
- [ ] New IPC handler `gitlab:getIssue` accepts (projectPath, issueIid, instanceUrl?) and returns full issue details with comments
- [ ] Both handlers use `getGitLabConfig(instanceUrl)` for authentication (matching the MR pattern)
- [ ] Uses the existing `gitlabApiRequest` helper
- [ ] GitLab API endpoints: GET /api/v4/projects/{encoded_path}/issues?state={state}&per_page=50&order_by=updated_at&sort=desc, GET /api/v4/projects/{encoded_path}/issues/{iid}, GET /api/v4/projects/{encoded_path}/issues/{iid}/notes?per_page=50&sort=asc (filter system notes)
- [ ] GitLab state mapping: 'open' -> 'opened', 'closed' -> 'closed'
- [ ] Preload exposes `window.electronAPI.gitlab.listIssues(projectPath, state?, instanceUrl?)` and `window.electronAPI.gitlab.getIssue(projectPath, issueIid, instanceUrl?)`
- [ ] Type definitions added to useLayoutState.ts
- [ ] Typecheck passes, existing tests pass

### US-IS-003: GitHub Issues sidebar section
**Description:** As a user, I want to see GitHub Issues in the sidebar so I can track issues alongside my code.

**Acceptance Criteria:**
- [ ] New IssuesSection component in Sidebar.tsx, rendered below the PullRequestsSection
- [ ] Shows "Log in to GitHub in Settings to view issues" when not logged in
- [ ] Shows "Not a GitHub repository" when the repo has no GitHub remote
- [ ] Reuses the GitHub remote parsing from PullRequestsSection (ghInfo with owner/repo)
- [ ] Has Open/Closed filter tabs matching the PR section's style
- [ ] Each issue row shows: issue number (#123), title, label badges (colored), comment count icon if > 0
- [ ] Clicking an issue opens a detail overlay (same pattern as PR detail overlay) showing: title, number, state badge, author, labels, body text, and comments
- [ ] Detail overlay has an "Open in GitHub" link button
- [ ] Detail overlay has a close button and backdrop click to dismiss
- [ ] Issues refresh on repo:changed events (debounced)
- [ ] Typecheck passes

### US-IS-004: GitLab Issues sidebar section
**Description:** As a user, I want to see GitLab Issues in the sidebar for GitLab-hosted repos.

**Acceptance Criteria:**
- [ ] New GitLabIssuesSection component in Sidebar.tsx, rendered below the MergeRequestsSection
- [ ] Shows "Log in to GitLab in Settings to view issues" when not logged in
- [ ] Shows "Not a GitLab repository" when the repo has no GitLab remote
- [ ] Reuses the GitLab remote parsing from MergeRequestsSection (glInfo with projectPath + instanceUrl)
- [ ] Has Open/Closed filter tabs matching the MR section's style
- [ ] Each issue row shows: issue number (!123 or #123), title, label badges (colored), comment count
- [ ] Clicking an issue opens a detail overlay showing: title, number, state, author, labels, body, comments
- [ ] Detail overlay has an "Open in GitLab" link button
- [ ] Passes instanceUrl through to all IPC calls (same pattern as MR section)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: List GitHub Issues via GitHub REST API, filtering out pull requests
- FR-2: List GitLab Issues via GitLab REST API
- FR-3: Display issues in sidebar with Open/Closed filter tabs
- FR-4: Show issue detail overlay with body and comments on click
- FR-5: Reuse existing authentication — no additional login required
- FR-6: Support custom GitLab instances (pass instanceUrl)

## Non-Goals

- No creating issues from within the app (view-only for now)
- No editing or closing issues
- No issue labels management
- No linking issues to commits (future feature)
- No notification badges for new issues

## Technical Considerations

- **Reuse patterns from PRs/MRs** — The IssuesSection should be structurally identical to PullRequestsSection/MergeRequestsSection. Copy the pattern, change the data types and API endpoints.
- **GitHub Issues API quirk** — The /issues endpoint returns both issues AND pull requests. Filter by checking that `pull_request` field is absent in each result.
- **Label colors** — GitHub provides label colors as hex strings (without #). GitLab provides them with #. Normalize to include # for CSS.
- **Detail overlay** — Reuse the existing `prDetailOverlay` CSS class and pattern from the PR/MR sections.
- **Body rendering** — Issue bodies are markdown. For simplicity, render as pre-formatted text (same as PR/MR body rendering). No need for a full markdown renderer.

## Success Metrics

- Issues load within 2 seconds of opening the section
- Switching between Open/Closed is instant (separate API call)
- All existing PR/MR sidebar functionality unaffected
