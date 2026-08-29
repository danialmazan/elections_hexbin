import type { Language } from './types'

export const copy = {
  en: {
    eyebrow: 'Congress of Deputies · 350 seats', title: 'Spain, seat by seat',
    intro: 'Every hexagon is one elected deputy.',
    election: 'Election', language: 'Language', map: 'Seat cartogram of Spain', legend: 'Parties winning seats',
    national: 'National result', province: 'Province', region: 'Autonomous community', reset: 'Return to Spain',
    search: 'Find a province', searchPlaceholder: 'Type a province name…', party: 'Candidacy', votes: 'Votes', share: 'Vote %', seats: 'Seats',
    turnout: 'Turnout', electorate: 'Electorate', valid: 'Valid', blank: 'Blank', null: 'Null', majority: '176 for a majority',
    others: 'Other candidacies', methodology: 'Methodology & sources', methodText: 'Regular hexagons represent seats, not land or population. The layout is derived from official IGN province geometry; position, outline and adjacency are preserved as far as exact seat counts allow. Provinces and party blocks are connected, and island groups use cartogram insets. Vote share uses valid votes, including blank ballots.',
    source: 'Definitive result', dataNote: 'Results are final JEC/BOE figures; regional and national totals are derived from province rows.',
    tooltipSeats: 'seats in this province', clearParty: 'Clear party highlight', select: 'Select', selected: 'Selected', close: 'Close tooltip', view: 'Results shown',
  },
  es: {
    eyebrow: 'Congreso de los Diputados · 350 escaños', title: 'España, escaño a escaño',
    intro: 'Cada hexágono es un diputado electo.',
    election: 'Elección', language: 'Idioma', map: 'Cartograma de escaños de España', legend: 'Partidos con representación',
    national: 'Resultado nacional', province: 'Provincia', region: 'Comunidad autónoma', reset: 'Volver a España',
    search: 'Buscar provincia', searchPlaceholder: 'Escribe el nombre…', party: 'Candidatura', votes: 'Votos', share: '% voto', seats: 'Escaños',
    turnout: 'Participación', electorate: 'Censo', valid: 'Válidos', blank: 'Blancos', null: 'Nulos', majority: '176 para la mayoría',
    others: 'Otras candidaturas', methodology: 'Metodología y fuentes', methodText: 'Los hexágonos regulares representan escaños, no territorio ni población. La disposición deriva de la geometría provincial oficial del IGN; conserva posición, contorno y vecindad hasta donde permiten los recuentos exactos. Las provincias y los bloques de partido son contiguos, y las islas se muestran en recuadros cartográficos. El porcentaje usa votos válidos, incluidos los votos en blanco.',
    source: 'Resultado definitivo', dataNote: 'Los resultados son cifras finales de la JEC/BOE; los totales autonómicos y nacionales se derivan de las filas provinciales.',
    tooltipSeats: 'escaños en esta provincia', clearParty: 'Quitar filtro de partido', select: 'Seleccionar', selected: 'Seleccionada', close: 'Cerrar información', view: 'Resultados mostrados',
  },
} as const

export function formatNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-GB').format(value)
}
