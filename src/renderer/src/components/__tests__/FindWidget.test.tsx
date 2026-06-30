// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FindWidget, type FindWidgetProps } from '../FindWidget'

afterEach(() => cleanup())

function setup(over: Partial<FindWidgetProps> = {}) {
  const props: FindWidgetProps = {
    query: 'foo', onQueryChange: vi.fn(),
    caseSensitive: false, wholeWord: false,
    onToggleCase: vi.fn(), onToggleWholeWord: vi.fn(),
    count: 3, currentIndex: 0,
    onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
    ...over
  }
  render(<FindWidget {...props} />)
  return props
}

describe('FindWidget', () => {
  it('renders the N of M counter', () => {
    setup({ count: 3, currentIndex: 1 })
    expect(screen.getByText('2 of 3')).toBeTruthy()
  })
  it('renders "No results" when count is 0', () => {
    setup({ count: 0 })
    expect(screen.getByText('No results')).toBeTruthy()
  })
  it('Enter triggers onNext, Shift+Enter triggers onPrev', () => {
    const p = setup()
    const input = screen.getByPlaceholderText('Find')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onNext).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(p.onPrev).toHaveBeenCalledOnce()
  })
  it('Escape triggers onClose', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByPlaceholderText('Find'), { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledOnce()
  })
  it('typing fires onQueryChange', () => {
    const p = setup()
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'bar' } })
    expect(p.onQueryChange).toHaveBeenCalledWith('bar')
  })
  it('toggle buttons fire their callbacks', () => {
    const p = setup()
    fireEvent.click(screen.getByTitle('Match Case'))
    fireEvent.click(screen.getByTitle('Match Whole Word'))
    expect(p.onToggleCase).toHaveBeenCalledOnce()
    expect(p.onToggleWholeWord).toHaveBeenCalledOnce()
  })
})
