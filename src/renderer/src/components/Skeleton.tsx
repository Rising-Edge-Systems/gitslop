import React from 'react'
import styles from './Skeleton.module.css'

// ─── Base Skeleton Element ───────────────────────────────────────────────────

interface SkeletonProps {
  /** Width of the skeleton element (CSS value) */
  width?: string
  /** Height of the skeleton element (CSS value) */
  height?: string
  /** Border radius variant */
  radius?: 'sm' | 'md' | 'lg' | 'circle'
  /** Additional CSS class */
  className?: string
  /** Display style */
  display?: 'block' | 'inline-block'
}

export function Skeleton({
  width = '100%',
  height = '16px',
  radius = 'sm',
  className = '',
  display = 'block'
}: SkeletonProps): React.JSX.Element {
  return (
    <div
      className={`${styles.skeleton} ${styles[radius]} ${className}`}
      style={{ width, height, display }}
      aria-hidden="true"
    />
  )
}

// ─── Skeleton Row (icon + text line) ─────────────────────────────────────────

interface SkeletonRowProps {
  /** Width of the icon circle */
  iconSize?: string
  /** Width of the text line (CSS value) */
  textWidth?: string
  /** Height of the text line */
  textHeight?: string
  className?: string
}

export function SkeletonRow({
  iconSize = '16px',
  textWidth = '70%',
  textHeight = '12px',
  className = ''
}: SkeletonRowProps): React.JSX.Element {
  return (
    <div className={`${styles.row} ${className}`}>
      <Skeleton width={iconSize} height={iconSize} radius="circle" />
      <Skeleton width={textWidth} height={textHeight} radius="sm" />
    </div>
  )
}

// ─── Skeleton List (multiple rows) ───────────────────────────────────────────

interface SkeletonListProps {
  /** Number of skeleton rows */
  count?: number
  /** Whether to show icon circles */
  showIcon?: boolean
  /** Vary widths for natural look */
  varyWidths?: boolean
  className?: string
}

const VARIED_WIDTHS = ['85%', '60%', '75%', '50%', '90%', '65%', '80%', '55%', '70%', '45%']

export function SkeletonList({
  count = 5,
  showIcon = true,
  varyWidths = true,
  className = ''
}: SkeletonListProps): React.JSX.Element {
  return (
    <div className={`${styles.list} ${className}`}>
      {Array.from({ length: count }, (_, i) => {
        const width = varyWidths ? VARIED_WIDTHS[i % VARIED_WIDTHS.length] : '70%'
        return showIcon ? (
          <SkeletonRow key={i} textWidth={width} />
        ) : (
          <div className={styles.row} key={i}>
            <Skeleton width={width} height="12px" radius="sm" />
          </div>
        )
      })}
    </div>
  )
}

// ─── Sidebar Skeleton ────────────────────────────────────────────────────────

export function SidebarSkeleton(): React.JSX.Element {
  return (
    <div className={styles.sidebarSkeleton}>
      {/* Section header */}
      <div className={styles.sectionHeader}>
        <Skeleton width="14px" height="14px" radius="sm" />
        <Skeleton width="80px" height="14px" radius="sm" />
        <Skeleton width="24px" height="14px" radius="sm" display="inline-block" />
      </div>
      <SkeletonList count={4} showIcon={true} />

      {/* Section header */}
      <div className={styles.sectionHeader}>
        <Skeleton width="14px" height="14px" radius="sm" />
        <Skeleton width="60px" height="14px" radius="sm" />
      </div>
      <SkeletonList count={2} showIcon={true} />

      {/* Section header */}
      <div className={styles.sectionHeader}>
        <Skeleton width="14px" height="14px" radius="sm" />
        <Skeleton width="40px" height="14px" radius="sm" />
      </div>
      <SkeletonList count={3} showIcon={true} />
    </div>
  )
}

// ─── Commit Graph Skeleton ───────────────────────────────────────────────────

export function CommitGraphSkeleton(): React.JSX.Element {
  const rows = 12
  return (
    <div className={styles.graphSkeleton}>
      {/* Header */}
      <div className={styles.graphHeader}>
        <Skeleton width="120px" height="16px" radius="sm" />
        <Skeleton width="20px" height="20px" radius="circle" />
      </div>
      {/* Commit rows */}
      {Array.from({ length: rows }, (_, i) => (
        <div className={styles.graphRow} key={i}>
          {/* Graph lane dots */}
          <div className={styles.graphLane}>
            <Skeleton
              width="10px"
              height="10px"
              radius="circle"
            />
            {i % 3 === 0 && (
              <Skeleton
                width="10px"
                height="10px"
                radius="circle"
              />
            )}
          </div>
          {/* Commit info */}
          <div className={styles.graphInfo}>
            <Skeleton width="60px" height="11px" radius="sm" />
            <Skeleton
              width={VARIED_WIDTHS[i % VARIED_WIDTHS.length]}
              height="12px"
              radius="sm"
            />
            <Skeleton width="70px" height="11px" radius="sm" />
            <Skeleton width="50px" height="11px" radius="sm" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Diff Viewer Skeleton ────────────────────────────────────────────────────

export function DiffSkeleton(): React.JSX.Element {
  return (
    <div className={styles.diffSkeleton}>
      <div className={styles.diffHeader}>
        <Skeleton width="200px" height="14px" radius="sm" />
        <Skeleton width="80px" height="24px" radius="md" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div className={styles.diffLine} key={i}>
          <Skeleton width="30px" height="12px" radius="sm" />
          <Skeleton
            width={VARIED_WIDTHS[(i + 3) % VARIED_WIDTHS.length]}
            height="12px"
            radius="sm"
          />
        </div>
      ))}
    </div>
  )
}

// ─── Repo View Skeleton (initial repo load) ──────────────────────────────────

export function RepoViewSkeleton(): React.JSX.Element {
  return (
    <div className={styles.repoSkeleton}>
      {/* Summary cards */}
      <div className={styles.repoCards}>
        {Array.from({ length: 4 }, (_, i) => (
          <div className={styles.repoCard} key={i}>
            <Skeleton width="36px" height="36px" radius="md" />
            <div className={styles.repoCardText}>
              <Skeleton width="60px" height="11px" radius="sm" />
              <Skeleton width="80px" height="14px" radius="sm" />
            </div>
          </div>
        ))}
      </div>
      {/* Graph placeholder */}
      <CommitGraphSkeleton />
    </div>
  )
}
