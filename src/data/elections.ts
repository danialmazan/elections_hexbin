import rawManifest from './election-manifest.json'
import type { ElectionId, ElectionManifestEntry, ElectionPayload } from '../types'

export const electionManifest = rawManifest as ElectionManifestEntry[]

const payloadCache = new Map<ElectionId, ElectionPayload>()
const requestCache = new Map<ElectionId, Promise<ElectionPayload>>()

export function findElection(id: string | null) {
  return electionManifest.find((item) => item.id === id) ?? null
}

export function loadElection(id: ElectionId): Promise<ElectionPayload> {
  const cached = payloadCache.get(id)
  if (cached) return Promise.resolve(cached)
  const pending = requestCache.get(id)
  if (pending) return pending
  const entry = findElection(id)
  if (!entry) return Promise.reject(new Error(`Unknown election: ${id}`))
  const request = fetch(`${import.meta.env.BASE_URL}${entry.dataFile}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Election data request failed (${response.status})`)
      const payload = await response.json() as ElectionPayload
      if (payload.schemaVersion !== 1 || payload.election.id !== id || payload.layout.electionId !== id) {
        throw new Error(`Election data does not match ${id}`)
      }
      payloadCache.set(id, payload)
      return payload
    })
    .finally(() => requestCache.delete(id))
  requestCache.set(id, request)
  return request
}

export function clearElectionCache() {
  payloadCache.clear()
  requestCache.clear()
}
