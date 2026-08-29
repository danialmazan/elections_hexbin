import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('../src/data/generated.json', import.meta.url)))
const publishedSeats = {
  '2023-07-23': { PP: 137, PSOE: 121, VOX: 33, SUMAR: 31, ERC: 7, JUNTS: 7, EHB: 6, PNV: 5, BNG: 1, CC: 1, UPN: 1 },
  '2019-11-10': { PSOE: 120, PP: 89, VOX: 52, UP: 35, ERC: 13, CS: 10, JUNTS: 8, PNV: 6, EHB: 5, MAS: 3, CUP: 2, CC: 2, NA: 2, BNG: 1, PRC: 1, TERUEL: 1 },
  '2019-04-28': { PSOE: 123, PP: 66, CS: 57, UP: 42, VOX: 24, ERC: 15, JUNTS: 7, PNV: 6, EHB: 4, CC: 2, NA: 2, MAS: 1, PRC: 1 },
}
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
const key = ({ q, r }) => `${q},${r}`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function connected(cells, label) {
  if (!cells.length) return
  const nodes = new Set(cells.map(key))
  const seen = new Set([key(cells[0])])
  const queue = [cells[0]]
  while (queue.length) {
    const cell = queue.shift()
    for (const [dq, dr] of directions) {
      const next = `${cell.q + dq},${cell.r + dr}`
      if (nodes.has(next) && !seen.has(next)) {
        seen.add(next)
        queue.push({ q: cell.q + dq, r: cell.r + dr })
      }
    }
  }
  assert(seen.size === cells.length, `${label} is disconnected`)
}

assert(data.elections.length === 3 && data.layouts.length === 3, 'Expected three elections and layouts')
for (const election of data.elections) {
  const expectedRegions = { '28': '13', '31': '15', '30': '14', '46': '10', '48': '16', '26': '17' }
  for (const [provinceId, regionId] of Object.entries(expectedRegions)) {
    assert(election.provinces.find((province) => province.id === provinceId)?.regionId === regionId, `${election.id}: incorrect INE region mapping for province ${provinceId}`)
  }
  const layout = data.layouts.find((item) => item.electionId === election.id)
  assert(layout?.cells.length === 350, `${election.id}: layout does not contain 350 seats`)
  assert(new Set(layout.cells.map(key)).size === 350, `${election.id}: duplicate coordinates`)
  assert(election.national.results.reduce((sum, row) => sum + row.seats, 0) === 350, `${election.id}: national seats do not total 350`)
  const actualSeats = Object.fromEntries(election.national.results.filter((row) => row.seats).map((row) => [row.partyId, row.seats]))
  assert(JSON.stringify(actualSeats) === JSON.stringify(publishedSeats[election.id]), `${election.id}: published seat allocation mismatch`)
  for (const province of election.provinces) {
    const cells = layout.cells.filter((cell) => cell.provinceId === province.id)
    assert(cells.length === province.results.reduce((sum, row) => sum + row.seats, 0), `${election.id}/${province.id}: seat mismatch`)
    connected(cells, `${election.id}/${province.id}`)
    for (const row of province.results.filter((item) => item.seats)) {
      connected(cells.filter((cell) => cell.partyId === row.partyId), `${election.id}/${province.id}/${row.partyId}`)
    }
  }
  const provinceVotes = election.provinces.reduce((sum, province) => sum + province.results.reduce((inner, row) => inner + row.votes, 0), 0)
  const nationalVotes = election.national.results.reduce((sum, row) => sum + row.votes, 0)
  assert(provinceVotes === nationalVotes, `${election.id}: province and national votes do not reconcile`)
}
const april = data.layouts.find((item) => item.electionId === '2019-04-28').cells.map(key).sort()
const november = data.layouts.find((item) => item.electionId === '2019-11-10').cells.map(key).sort()
assert(JSON.stringify(april) === JSON.stringify(november), 'The two 2019 elections do not share geometry')
const geographicCells = data.layouts.find((item) => item.electionId === '2019-11-10').cells
const provinceCenter = (provinceId) => {
  const cells = geographicCells.filter((cell) => cell.provinceId === provinceId)
  return {
    x: cells.reduce((sum, cell) => sum + cell.q + cell.r / 2, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.r, 0) / cells.length,
  }
}
const madrid = provinceCenter('28')
assert(provinceCenter('15').x < madrid.x, 'A Coruña must remain west of Madrid')
assert(provinceCenter('08').x > madrid.x, 'Barcelona must remain east of Madrid')
assert(provinceCenter('46').x > madrid.x, 'Valencia must remain east of Madrid')
assert(provinceCenter('33').y < madrid.y, 'Asturias must remain north of Madrid')
assert(provinceCenter('41').y > madrid.y, 'Seville must remain south of Madrid')
console.log('Data and geometry validation passed for all three elections.')
