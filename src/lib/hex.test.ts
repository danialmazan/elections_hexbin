import payload from '../../public/data/elections/2023-07-23.json'
import { boundaryPath, points } from './hex'
import type { CartogramCell, ElectionPayload } from '../types'

const data = payload as ElectionPayload

describe('regular hex geometry', () => {
  it('emits six equal sides for every seat', () => {
    for (const cell of data.layout.cells) {
      const vertices = points(cell).split(' ').map((point) => point.split(',').map(Number))
      const lengths = vertices.map(([x, y], index) => {
        const [nextX, nextY] = vertices[(index + 1) % 6]
        return Math.hypot(nextX - x, nextY - y)
      })
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(1e-9)
    }
  })

  it('classifies all three boundary levels from shared cell edges', () => {
    const cells = data.layout.cells as CartogramCell[]
    expect(boundaryPath(cells, 'province')).toContain('M')
    expect(boundaryPath(cells, 'region')).toContain('M')
    expect(boundaryPath(cells, 'nation')).toContain('M')
  })
})
