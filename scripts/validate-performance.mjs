import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const assets = readdirSync(new URL('../dist/assets/', import.meta.url))
const script = assets.find((name) => name.endsWith('.js'))
if (!script) throw new Error('Production JavaScript asset not found')
const gzipBytes = gzipSync(readFileSync(new URL(`../dist/assets/${script}`, import.meta.url))).length
if (gzipBytes > 150 * 1024) throw new Error(`Initial JavaScript is ${(gzipBytes / 1024).toFixed(1)} KB gzip; budget is 150 KB`)
console.log(`Initial JavaScript performance budget passed (${(gzipBytes / 1024).toFixed(1)} KB gzip).`)
