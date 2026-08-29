import generated from '../data/generated.json'
import { boundaryPath, points } from './hex'
import type { CartogramCell, GeneratedDataset } from '../types'

const data = generated as GeneratedDataset

describe('regular hex geometry', () => {
  it('emits six equal sides for every seat', () => {
    for (const layout of data.layouts) for (const cell of layout.cells) {
      const vertices = points(cell).split(' ').map((point) => point.split(',').map(Number))
      const lengths = vertices.map(([x, y], index) => {
        const [nextX, nextY] = vertices[(index + 1) % 6]
        return Math.hypot(nextX - x, nextY - y)
      })
      expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(1e-9)
    }
  })

  it('classifies all three boundary levels from shared cell edges', () => {
    const cells = data.layouts[0].cells as CartogramCell[]
    expect(boundaryPath(cells, 'province')).toContain('M')
    expect(boundaryPath(cells, 'region')).toContain('M')
    expect(boundaryPath(cells, 'nation')).toContain('M')
  })
})
