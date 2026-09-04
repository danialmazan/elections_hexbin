import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifest = JSON.parse(readFileSync(new URL('../src/data/election-manifest.json', import.meta.url)))
const expectedIds = ['2023-07-23', '2019-11-10', '2019-04-28', '2016-06-26', '2015-12-20', '2011-11-20', '2008-03-09', '2004-03-14', '2000-03-12', '1996-03-03', '1993-06-06', '1989-10-29', '1986-06-22', '1982-10-28', '1979-03-01', '1977-06-15']
const reviewedCurrentHashes = {
  '2023-07-23': '0b55454d0450b4e8a26dab58becc27bed9e2ab17558ddbeb68cca054dfe9a0c9',
  '2019-11-10': 'ab8cf977abfbb41a49bad3cbf62fedbc44be0be1b2a591814537674255822cf2',
  '2019-04-28': 'cd8313dcf8d9872f6c5b900368aef0c0c000b46251644a1e93ce1b1fe7a1ac17',
}
const publishedAllocationHashes = {
  '1977-06-15': '23a6b35834b180d364531ec8e9611c6966adae27e2a03802d309850bfbce81d9',
  '1979-03-01': '51f66a3a51ec98b69f796d35d805d9e2321c9b577bfa301e311ac4a0493bbef5',
  '1982-10-28': 'd56dee2488f315c1f4b02dd8f6e5f3fe91c59c85bf01f86fb04c23788048cee9',
  '1986-06-22': '27f8586efa2751c2e2f26d6e11991ed1050fbadfd06e68d74641a8b7cc16db11',
  '1989-10-29': 'cb439c421964555c8e61ec32396a51faf16b56ce9419e0fffc115ca3e0cf85a8',
  '1993-06-06': '15a39ca64cd1fcebba53077d49dce8f04b0ba9da909f84502d33b283f0a944c6',
  '1996-03-03': '007e7ae707d0e6359fa375d0a31938b7f5a23932296564cc8b80bacf65a14e81',
  '2000-03-12': 'bd32b5ea20c6d8d815b50d7b829eb219ccd15b7fe6f88284e6e8d57483d89c1c',
  '2004-03-14': '18e85c7d156a09d28be675fbd5f0427bd7e49f2bf258e177249165907c8186d0',
  '2008-03-09': '4f7e163315a38ae1e4ccf9cfae49b0d09850ccdcfaed5c3f445cc612ada86acb',
  '2011-11-20': 'a4ebeed4242df8d1e74de30719ec9e46e13b92b1a56368f05fda8b01d4b554f8',
  '2015-12-20': '3fdd1667bebd4e080a1ee0d787ac4f09fa6d63e6b6f07cdd128d9e1bdd61406c',
  '2016-06-26': '5a9fedf8ddc578bd54b02310d5c1c4b35bbbd311084109877a9b4fbbdae8e59d',
  '2019-04-28': '8e3439c8c25de7b91b9b271e987e7a2a8096a0f9899217b4b3f7da15136a3483',
  '2019-11-10': '9c888dd6e88397a548f48a85573f161968c06e0db6d997b8e54bad1f84ed4deb',
  '2023-07-23': '6930f5da2f1fa29f69baa7ba36111541186c7d9cff3c95bdffe4f1a8fa28b3fc',
}
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
const key = ({ q, r }) => `${q},${r}`
const hash = (value) => createHash('sha256').update(value).digest('hex')
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function connected(cells, label) {
  if (!cells.length) return
  const nodes = new Set(cells.map(key)); const seen = new Set([key(cells[0])]); const queue = [cells[0]]
  while (queue.length) {
    const cell = queue.shift()
    for (const [dq, dr] of directions) {
      const next = `${cell.q + dq},${cell.r + dr}`
      if (nodes.has(next) && !seen.has(next)) { seen.add(next); queue.push({ q: cell.q + dq, r: cell.r + dr }) }
    }
  }
  assert(seen.size === cells.length, `${label} is disconnected`)
}

assert(JSON.stringify(manifest.map((item) => item.id)) === JSON.stringify(expectedIds), 'Manifest does not contain the 16 elections in newest-first order')
for (const [index, item] of manifest.entries()) {
  assert(item.newerId === (manifest[index - 1]?.id ?? null), `${item.id}: incorrect newer election`)
  assert(item.olderId === (manifest[index + 1]?.id ?? null), `${item.id}: incorrect older election`)
  const bytes = readFileSync(new URL(`../public/${item.dataFile}`, import.meta.url)); const payload = JSON.parse(bytes)
  const { election, layout } = payload
  assert(gzipSync(bytes).length <= 30 * 1024, `${item.id}: payload exceeds 30 KB gzip`)
  assert(election.id === item.id && layout.electionId === item.id, `${item.id}: payload identity mismatch`)
  assert(election.provinces.length === 52 && election.regions.length === 19, `${item.id}: expected 52 provinces and 19 present-day regional groups`)
  assert(layout.cells.length === 350 && new Set(layout.cells.map(key)).size === 350, `${item.id}: layout must contain 350 unique cells`)
  assert(election.national.results.reduce((sum, row) => sum + row.seats, 0) === 350, `${item.id}: national seats do not total 350`)
  const provinceVotes = election.provinces.reduce((sum, province) => sum + province.results.reduce((inner, row) => inner + row.votes, 0), 0)
  const nationalVotes = election.national.results.reduce((sum, row) => sum + row.votes, 0)
  assert(provinceVotes === nationalVotes, `${item.id}: province and national candidacy votes do not reconcile`)
  for (const province of election.provinces) {
    assert(province.stats.valid === province.stats.partyVotes + province.stats.blank, `${item.id}/${province.id}: valid ballots do not reconcile`)
    const cells = layout.cells.filter((cell) => cell.provinceId === province.id)
    assert(cells.length === province.results.reduce((sum, row) => sum + row.seats, 0), `${item.id}/${province.id}: seat and cell totals differ`)
    connected(cells, `${item.id}/${province.id}`)
    for (const row of province.results.filter((result) => result.seats)) connected(cells.filter((cell) => cell.partyId === row.partyId), `${item.id}/${province.id}/${row.partyId}`)
  }
  const allocation = election.provinces.flatMap((province) => province.results.filter((row) => row.seats).map((row) => `${province.id}:${row.partyId}:${row.seats}`)).sort().join('|')
  assert(hash(allocation) === publishedAllocationHashes[item.id], `${item.id}: published province allocation changed`)
  if (reviewedCurrentHashes[item.id]) assert(hash(JSON.stringify({ election, layout })) === reviewedCurrentHashes[item.id], `${item.id}: reviewed current election changed`)
}

console.log('Data, provenance, geometry and performance validation passed for all 16 elections.')
