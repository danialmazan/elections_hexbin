import type { CartogramCell } from '../types'

export const HEX_SIZE = 10
export const NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const

export function center(q: number, r: number) {
  return { x: Math.sqrt(3) * HEX_SIZE * (q + r / 2), y: 1.5 * HEX_SIZE * r }
}

export function points(cell: Pick<CartogramCell, 'q' | 'r'>) {
  const { x, y } = center(cell.q, cell.r)
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((-90 + index * 60) * Math.PI) / 180
    return `${x + HEX_SIZE * Math.cos(angle)},${y + HEX_SIZE * Math.sin(angle)}`
  }).join(' ')
}

const EDGE_VERTICES = [[1, 2], [0, 1], [5, 0], [4, 5], [3, 4], [2, 3]] as const

export function boundaryPath(cells: CartogramCell[], level: 'province' | 'region' | 'nation') {
  const lookup = new Map(cells.map((cell) => [`${cell.q},${cell.r}`, cell]))
  const segments: string[] = []
  for (const cell of cells) {
    const { x, y } = center(cell.q, cell.r)
    const vertices = Array.from({ length: 6 }, (_, index) => {
      const angle = ((-90 + index * 60) * Math.PI) / 180
      return [x + HEX_SIZE * Math.cos(angle), y + HEX_SIZE * Math.sin(angle)]
    })
    NEIGHBORS.forEach(([dq, dr], index) => {
      const neighbor = lookup.get(`${cell.q + dq},${cell.r + dr}`)
      const draw = level === 'nation' ? !neighbor
        : level === 'region' ? Boolean(neighbor && neighbor.regionId !== cell.regionId)
        : Boolean(neighbor && neighbor.provinceId !== cell.provinceId)
      if (draw) {
        const [a, b] = EDGE_VERTICES[index]
        segments.push(`M${vertices[a][0]},${vertices[a][1]}L${vertices[b][0]},${vertices[b][1]}`)
      }
    })
  }
  return segments.join('')
}

export function viewBox(cells: CartogramCell[]) {
  const centers = cells.map((cell) => center(cell.q, cell.r))
  const xs = centers.map(({ x }) => x)
  const ys = centers.map(({ y }) => y)
  const minX = Math.min(...xs) - HEX_SIZE - 7
  const minY = Math.min(...ys) - HEX_SIZE - 7
  const width = Math.max(...xs) - minX + HEX_SIZE + 7
  const height = Math.max(...ys) - minY + HEX_SIZE + 7
  return `${minX} ${minY} ${width} ${height}`
}
