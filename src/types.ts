export type Language = 'en' | 'es'
export type ElectionId = string

export interface LocalizedText {
  en: string
  es: string
}

export interface PartyMeta {
  id: string
  short: string
  name: LocalizedText
  color: string
  aliases: string[]
}

export interface ElectionStats {
  electors: number
  voters: number
  valid: number
  partyVotes: number
  blank: number
  invalid: number
  turnout: number
}

export interface ResultRow {
  partyId: string
  votes: number
  share: number
  seats: number
}

export interface GeographyResult {
  stats: ElectionStats
  results: ResultRow[]
}

export interface ProvinceResult extends GeographyResult {
  id: string
  regionId: string
  name: LocalizedText
}

export interface RegionResult extends GeographyResult {
  id: string
  name: LocalizedText
  provinceIds: string[]
}

export interface ElectionData {
  id: ElectionId
  date: string
  label: LocalizedText
  parties: PartyMeta[]
  national: GeographyResult
  regions: RegionResult[]
  provinces: ProvinceResult[]
  provenance: {
    resultPublisher: string
    resultUrl: string
    finalStatus: string
    retrieved: string
    transformations: string[]
  }
}

export interface CartogramCell {
  id: string
  q: number
  r: number
  provinceId: string
  regionId: string
  partyId: string
}

export interface CartogramLayout {
  electionId: ElectionId
  cells: CartogramCell[]
}

export interface ElectionPayload {
  schemaVersion: 1
  election: ElectionData
  layout: CartogramLayout
}

export interface ElectionManifestEntry {
  id: ElectionId
  label: LocalizedText
  dataFile: string
  olderId: ElectionId | null
  newerId: ElectionId | null
}
