import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'

describe('election atlas', () => {
  beforeEach(() => history.replaceState(null, '', '/?election=2023-07-23&lang=en'))

  it('switches election and language while encoding state in the URL', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '10 November 2019' }))
    expect(location.search).toContain('election=2019-11-10')
    fireEvent.click(screen.getByRole('button', { name: 'ES' }))
    expect(screen.getByText('Resultado nacional')).toBeInTheDocument()
    expect(location.search).toContain('lang=es')
  })

  it('selects and resets a province using the accessible map target', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Madrid, Select/ }))
    expect(screen.getByRole('button', { name: 'Province', pressed: true })).toBeInTheDocument()
    expect(location.search).toContain('province=28')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText('National result')).toBeInTheDocument()
    expect(location.search).not.toContain('province=')
  })
})
