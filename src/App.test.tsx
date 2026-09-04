import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import current from '../public/data/elections/2023-07-23.json'
import november from '../public/data/elections/2019-11-10.json'
import historical from '../public/data/elections/1977-06-15.json'
import historicalNext from '../public/data/elections/1979-03-01.json'
import App from './App'
import { clearElectionCache } from './data/elections'

const payloads = new Map([
  ['2023-07-23', current],
  ['2019-11-10', november],
  ['1977-06-15', historical],
  ['1979-03-01', historicalNext],
])

function mockElectionFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const id = String(input).match(/(\d{4}-\d{2}-\d{2})\.json/)?.[1]
    const payload = id ? payloads.get(id) : null
    return { ok: Boolean(payload), status: payload ? 200 : 404, json: async () => payload } as Response
  })
}

describe('election atlas', () => {
  beforeEach(() => {
    clearElectionCache()
    history.replaceState(null, '', '/?election=2023-07-23&lang=en')
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads an election, switches with the dropdown, and encodes state in the URL', async () => {
    mockElectionFetch()
    render(<App />)
    expect(await screen.findByText('National result')).toBeInTheDocument()
    expect(screen.getByLabelText('Election').querySelectorAll('option')).toHaveLength(16)
    fireEvent.change(screen.getByLabelText('Election'), { target: { value: '2019-11-10' } })
    await waitFor(() => expect(location.search).toContain('election=2019-11-10'))
    expect(await screen.findByText('National result')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ES' }))
    expect(screen.getByText('Resultado nacional')).toBeInTheDocument()
    expect(location.search).toContain('lang=es')
  })

  it('uses chronological controls and caches an election after its first request', async () => {
    const request = mockElectionFetch()
    history.replaceState(null, '', '/?election=1977-06-15&lang=en')
    render(<App />)
    await screen.findByText('National result')
    expect(screen.getByRole('button', { name: 'Show the previous, older election' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Show the next, newer election' }))
    await waitFor(() => expect(location.search).toContain('election=1979-03-01'))
    await screen.findByText('National result')
    fireEvent.click(screen.getByRole('button', { name: 'Show the previous, older election' }))
    await waitFor(() => expect(location.search).toContain('election=1977-06-15'))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('selects and resets a province using the accessible map target', async () => {
    mockElectionFetch()
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /Madrid, Select/ }))
    expect(screen.getByRole('button', { name: 'Province', pressed: true })).toBeInTheDocument()
    expect(location.search).toContain('province=28')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText('National result')).toBeInTheDocument()
    expect(location.search).not.toContain('province=')
  })

  it('offers a retry when an election file fails to load', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => current } as Response)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('National result')).toBeInTheDocument()
  })
})
