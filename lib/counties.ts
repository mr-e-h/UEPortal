export const COUNTIES = [
  'Østfold',
  'Viken',
  'Oslo',
  'Innlandet',
  'Vestfold',
  'Telemark',
  'Agder',
  'Rogaland',
  'Vestland',
  'Møre og Romsdal',
  'Trøndelag',
  'Nordland',
  'Troms',
  'Finnmark',
] as const

export type County = (typeof COUNTIES)[number]
