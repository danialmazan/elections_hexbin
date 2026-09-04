import { useEffect, useMemo, useRef, useState } from 'react'
import { electionManifest, findElection, loadElection } from './data/elections'
import { copy, formatNumber } from './i18n'
import { boundaryPath, points, viewBox } from './lib/hex'
import type { CartogramCell, ElectionData, ElectionId, ElectionPayload, GeographyResult, Language, PartyMeta } from './types'

function readState() {
  const query = new URLSearchParams(location.search)
  const election = findElection(query.get('election'))?.id ?? '2023-07-23'
  const language: Language = query.get('lang') === 'en' ? 'en' : 'es'
  return { election, language, province: query.get('province') }
}

function ElectionControls({ election, language, onElection, onLanguage }: { election: ElectionId, language: Language, onElection: (id: ElectionId) => void, onLanguage: (value: Language) => void }) {
  const t = copy[language]
  const selected = findElection(election)!
  return <div className="controls">
    <div className="control-group"><label className="control-label" htmlFor="election-select">{t.election}</label><div className="election-picker">
      <button type="button" onClick={() => selected.olderId && onElection(selected.olderId)} disabled={!selected.olderId} aria-label={t.olderElection}>←</button>
      <select id="election-select" value={election} onChange={(event) => onElection(event.target.value)}>
        {electionManifest.map((item) => <option key={item.id} value={item.id}>{item.label[language]}</option>)}
      </select>
      <button type="button" onClick={() => selected.newerId && onElection(selected.newerId)} disabled={!selected.newerId} aria-label={t.newerElection}>→</button>
    </div></div>
    <div className="language" aria-label={t.language}>
      <button className={language === 'es' ? 'active' : ''} onClick={() => onLanguage('es')} aria-pressed={language === 'es'}>ES</button>
      <button className={language === 'en' ? 'active' : ''} onClick={() => onLanguage('en')} aria-pressed={language === 'en'}>EN</button>
    </div>
  </div>
}

function Legend({ election, language, highlighted, pinned, onHover, onPin }: { election: ElectionData, language: Language, highlighted: string | null, pinned: string | null, onHover: (id: string | null) => void, onPin: (id: string | null) => void }) {
  const t = copy[language]
  const winners = election.national.results.filter((row) => row.seats).map((row) => election.parties.find((party) => party.id === row.partyId)!).filter(Boolean)
  return <section className="legend" aria-label={t.legend}>
    <div className="section-kicker">{t.legend}</div>
    <div className="legend-items">
      {winners.map((party) => <button key={party.id} className={highlighted && highlighted !== party.id ? 'muted' : ''} aria-pressed={pinned === party.id} onPointerEnter={() => !pinned && onHover(party.id)} onPointerLeave={() => !pinned && onHover(null)} onFocus={() => !pinned && onHover(party.id)} onBlur={() => !pinned && onHover(null)} onClick={() => onPin(pinned === party.id ? null : party.id)}>
        <span className="swatch" style={{ background: party.color }} /><span>{party.short}</span>
      </button>)}
      {pinned && <button className="legend-clear" onClick={() => onPin(null)}>× {t.clearParty}</button>}
    </div>
  </section>
}

type HoverInfo = { cell: CartogramCell, x: number, y: number } | null

function HexCartogram({ election, cells, language, selectedProvince, highlightedParty, onSelect }: { election: ElectionData, cells: CartogramCell[], language: Language, selectedProvince: string | null, highlightedParty: string | null, onSelect: (id: string | null) => void }) {
  const [hover, setHover] = useState<HoverInfo>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const t = copy[language]
  const parties = useMemo(() => new Map(election.parties.map((party) => [party.id, party])), [election])
  const provinces = useMemo(() => new Map(election.provinces.map((province) => [province.id, province])), [election])
  const regions = useMemo(() => new Map(election.regions.map((region) => [region.id, region])), [election])
  const grouped = useMemo(() => {
    const groups = new Map<string, CartogramCell[]>()
    for (const cell of cells) groups.set(cell.provinceId, [...(groups.get(cell.provinceId) ?? []), cell])
    return groups
  }, [cells])
  function position(event: React.PointerEvent, cell: CartogramCell) {
    const rect = svgRef.current!.getBoundingClientRect()
    setHover({ cell, x: event.clientX - rect.left, y: event.clientY - rect.top })
  }
  const hoverProvince = hover ? provinces.get(hover.cell.provinceId) : null
  const hoverParty = hover ? parties.get(hover.cell.partyId) : null
  const hoverSeats = hoverProvince?.results.find((row) => row.partyId === hover?.cell.partyId)?.seats
  return <div className="map-shell">
    <svg ref={svgRef} className="map" viewBox={viewBox(cells)} role="img" aria-labelledby="map-title" onClick={(event) => { if (event.target === event.currentTarget) onSelect(null) }}>
      <title id="map-title">{t.map} — {election.label[language]}</title>
      <g className="cells">
        {[...grouped].map(([provinceId, provinceCells]) => {
          const province = provinces.get(provinceId)!
          return <g key={provinceId} role="button" tabIndex={0} aria-label={`${province.name[language]}, ${t.select}`} className={selectedProvince === provinceId ? 'province selected' : 'province'} onClick={() => onSelect(provinceId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(provinceId) } }}>
            {provinceCells.map((cell) => <polygon key={`${cell.q},${cell.r}`} points={points(cell)} fill={parties.get(cell.partyId)?.color ?? '#888'} className={highlightedParty && highlightedParty !== cell.partyId ? 'cell muted' : 'cell'} onPointerMove={(event) => position(event, cell)} onPointerLeave={() => setHover(null)} />)}
          </g>
        })}
      </g>
      <path className="boundary province-boundary" d={boundaryPath(cells, 'province')} />
      <path className="boundary region-halo" d={boundaryPath(cells, 'region')} />
      <path className="boundary region-boundary" d={boundaryPath(cells, 'region')} />
      <path className="boundary national-halo" d={boundaryPath(cells, 'nation')} />
      <path className="boundary national-boundary" d={boundaryPath(cells, 'nation')} />
    </svg>
    {hover && hoverProvince && hoverParty && <div className="tooltip" style={{ left: Math.min(hover.x + 14, (svgRef.current?.clientWidth ?? 300) - 220), top: hover.y + 12 }} role="status">
      <button aria-label={t.close} onClick={() => setHover(null)}>×</button><span>{regions.get(hover.cell.regionId)?.name[language]}</span><strong>{hoverProvince.name[language]}</strong><span className="tooltip-party"><i style={{ background: hoverParty.color }} />{hoverParty.short} · {hoverSeats} {t.tooltipSeats}</span>
    </div>}
  </div>
}

function ResultsTable({ result, parties, language }: { result: GeographyResult, parties: Map<string, PartyMeta>, language: Language }) {
  const t = copy[language]
  const winners = result.results.filter((row) => row.seats)
  const others = result.results.filter((row) => !row.seats)
  const rows = (items: typeof winners) => items.map((row) => { const party = parties.get(row.partyId); return <tr key={row.partyId}><th scope="row"><i style={{ background: party?.color }} />{party?.short ?? row.partyId}</th><td>{formatNumber(row.votes, language)}</td><td>{row.share.toFixed(2).replace('.', language === 'es' ? ',' : '.')}%</td><td className="seat-number">{row.seats}</td></tr> })
  return <><table><thead><tr><th>{t.party}</th><th>{t.votes}</th><th>{t.share}</th><th>{t.seats}</th></tr></thead><tbody>{rows(winners)}</tbody></table>
    {others.length > 0 && <details><summary>{t.others} <span>{others.length}</span></summary><table className="other-table"><tbody>{rows(others)}</tbody></table></details>}
  </>
}

function InspectorSection({ title, eyebrow, result, parties, language, majority }: { title: string, eyebrow: string, result: GeographyResult, parties: Map<string, PartyMeta>, language: Language, majority?: boolean }) {
  const t = copy[language]
  return <section className="result-section"><div className="section-kicker">{eyebrow}</div><h2>{title}</h2>
    <div className="stats"><div><strong>{result.stats.turnout.toFixed(1).replace('.', language === 'es' ? ',' : '.')}%</strong><span>{t.turnout}</span></div><div><strong>{formatNumber(result.stats.valid, language)}</strong><span>{t.valid}</span></div><div><strong>{formatNumber(result.stats.blank, language)}</strong><span>{t.blank}</span></div><div><strong>{formatNumber(result.stats.invalid, language)}</strong><span>{t.null}</span></div></div>
    {majority && <div className="majority"><span />{t.majority}</div>}
    <ResultsTable result={result} parties={parties} language={language} />
  </section>
}

function App() {
  const initial = useMemo(readState, [])
  const [electionId, setElectionId] = useState<ElectionId>(initial.election)
  const [language, setLanguage] = useState<Language>(initial.language)
  const [provinceId, setProvinceId] = useState<string | null>(initial.province)
  const [resultScope, setResultScope] = useState<'province' | 'region' | 'national'>(initial.province ? 'province' : 'national')
  const [hoveredParty, setHoveredParty] = useState<string | null>(null)
  const [pinnedParty, setPinnedParty] = useState<string | null>(null)
  const [payload, setPayload] = useState<ElectionPayload | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const election = payload?.election ?? null
  const layout = payload?.layout ?? null
  const province = election?.provinces.find((item) => item.id === provinceId) ?? null
  const region = province ? election?.regions.find((item) => item.id === province.regionId) ?? null : null
  const parties = useMemo(() => new Map((election?.parties ?? []).map((party) => [party.id, party])), [election])
  const t = copy[language]

  useEffect(() => {
    let active = true
    setPayload(null); setLoadError(false)
    loadElection(electionId).then((next) => { if (active) setPayload(next) }).catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [electionId, retry])
  useEffect(() => {
    const query = new URLSearchParams({ election: electionId, lang: language })
    if (provinceId) query.set('province', provinceId)
    history.replaceState(null, '', `${location.pathname}?${query}`)
    document.documentElement.lang = language
    document.title = language === 'es' ? 'España, escaño a escaño — cartograma electoral' : 'Spain, seat by seat — election cartogram'
  }, [electionId, language, provinceId])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setProvinceId(null); setResultScope('national'); setPinnedParty(null) } }
    addEventListener('keydown', escape); return () => removeEventListener('keydown', escape)
  }, [])
  const selectProvince = (id: string | null) => { setProvinceId(id); setResultScope(id ? 'province' : 'national') }
  const selectElection = (id: ElectionId) => { setElectionId(id); setPinnedParty(null); setHoveredParty(null) }

  return <main>
    <header><div><p className="eyebrow">{t.eyebrow}</p><h1>{t.title}</h1><p className="intro">{t.intro}</p></div><ElectionControls election={electionId} language={language} onElection={selectElection} onLanguage={setLanguage} /></header>
    {!payload && <section className="data-state" aria-live="polite">
      {loadError ? <><strong>{t.loadError}</strong><button onClick={() => setRetry((value) => value + 1)}>{t.retry}</button></> : <><span className="loader" aria-hidden="true" />{t.loading}</>}
    </section>}
    {election && layout && <div className="workspace">
      <div className="map-column">
        <div className="map-toolbar"><label>{t.search}<select value={provinceId ?? ''} onChange={(event) => selectProvince(event.target.value || null)}><option value="">{t.searchPlaceholder}</option>{election.provinces.slice().sort((a, b) => a.name[language].localeCompare(b.name[language])).map((item) => <option key={item.id} value={item.id}>{item.name[language]}</option>)}</select></label>{province && <button className="reset" onClick={() => selectProvince(null)}>← {t.reset}</button>}</div>
        <HexCartogram election={election} cells={layout.cells} language={language} selectedProvince={provinceId} highlightedParty={pinnedParty ?? hoveredParty} onSelect={selectProvince} />
        <Legend election={election} language={language} highlighted={pinnedParty ?? hoveredParty} pinned={pinnedParty} onHover={setHoveredParty} onPin={(id) => { setPinnedParty(id); setHoveredParty(null) }} />
        <details className="method"><summary>{t.methodology}</summary><p>{t.methodText}</p><p>{t.dataNote} <a href={election.provenance.resultUrl}>{t.source} ↗</a></p></details>
      </div>
      <aside className="inspector" aria-live="polite">
        {!province && <InspectorSection title={language === 'es' ? 'España' : 'Spain'} eyebrow={t.national} result={election.national} parties={parties} language={language} majority />}
        {province && <>
          <button className="inspector-reset" onClick={() => selectProvince(null)}>× {t.reset}</button>
          <div className="scope-control" aria-label={t.view}>
            <button className={resultScope === 'province' ? 'active' : ''} aria-pressed={resultScope === 'province'} onClick={() => setResultScope('province')}>{t.province}</button>
            <button className={resultScope === 'region' ? 'active' : ''} aria-pressed={resultScope === 'region'} onClick={() => setResultScope('region')}>{t.region}</button>
            <button className={resultScope === 'national' ? 'active' : ''} aria-pressed={resultScope === 'national'} onClick={() => setResultScope('national')}>{t.national}</button>
          </div>
          {resultScope === 'province' && <InspectorSection title={province.name[language]} eyebrow={t.province} result={province} parties={parties} language={language} />}
          {resultScope === 'region' && region && <InspectorSection title={region.name[language]} eyebrow={t.region} result={region} parties={parties} language={language} />}
          {resultScope === 'national' && <InspectorSection title={language === 'es' ? 'España' : 'Spain'} eyebrow={t.national} result={election.national} parties={parties} language={language} majority />}
        </>}
      </aside>
    </div>}
    <footer>Daniel Almazán · <a href="https://infoelectoral.interior.gob.es/es/elecciones-celebradas/area-de-descargas/index.html">Infoelectoral</a> · INE · JEC / BOE · <a href="https://centrodedescargas.cnig.es/CentroDescargas/detalleArchivo?sec=9000029">Obra derivada de BDLJE CC-BY 4.0, IGN</a></footer>
  </main>
}

export default App
