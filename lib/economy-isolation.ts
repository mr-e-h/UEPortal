/**
 * UE-PRIS-ISOLASJON — én delt strippe-helper for kundepris-feltene.
 *
 * Disse funksjonene gjør KUN nøkkel-fjerning. De avgjør IKKE *når* det
 * strippes — gatingen (typisk `if (!canSeeCustomerEconomics(session))` eller
 * `if (isSub(session))`) ligger fortsatt på hvert endepunkt, akkurat der den
 * lå før. Hensikten er å samle den håndrullede inline-destruktureringen som
 * tidligere var spredd på ~8 change-order-endepunkter til ett sted, slik at
 * sikkerhetsgrensen blir lettere å revidere.
 *
 * Tre kundepris-nøkler holdes UE-skjult:
 *   - customer_price_snapshot  (kundens enhetspris ved snapshot-tidspunkt)
 *   - total_customer_value     (salgsverdi = kundepris × mengde)
 *   - profit                   (fortjeneste = salgsverdi − kost)
 *
 * Hovedraden (change_orders) bærer alle tre. Linje-tabellene
 * (change_order_lines / change_order_consequence_lines) bærer kun
 * customer_price_snapshot — derfor en egen linje-variant.
 */

/** Kundepris-nøkler som ALDRI skal nå en UE. Brukt av deep-stripperen. */
export const CUSTOMER_PRICING_KEYS = ['customer_price_snapshot', 'total_customer_value', 'profit'] as const

const CUSTOMER_PRICING_KEY_SET: ReadonlySet<string> = new Set(CUSTOMER_PRICING_KEYS)

/**
 * Fjern de tre kundepris-nøklene fra en change_orders-rad. Returnerer en ny
 * Omit-typet rad uten customer_price_snapshot / total_customer_value / profit.
 * Identisk effekt som den tidligere inline-destruktureringen.
 *
 * Constraint dekker bare de tre nøklene (ikke `Record<string, unknown>`) slik
 * at interface-typer som ChangeOrder — som mangler implisitt index-signatur —
 * passerer.
 */
export function stripCustomerEconomics<
  T extends { customer_price_snapshot: unknown; total_customer_value: unknown; profit: unknown },
>(row: T): Omit<T, 'customer_price_snapshot' | 'total_customer_value' | 'profit'> {
  const { customer_price_snapshot: _cp, total_customer_value: _tcv, profit: _p, ...rest } = row
  return rest
}

/**
 * Fjern KUN customer_price_snapshot fra én linje-rad (change_order_lines eller
 * change_order_consequence_lines). Disse tabellene har ikke
 * total_customer_value / profit, så bare den ene nøkkelen fjernes — identisk
 * med den tidligere inline-strippen per linje.
 */
export function stripCustomerEconomicsLine<T extends { customer_price_snapshot: unknown }>(
  line: T,
): Omit<T, 'customer_price_snapshot'> {
  const { customer_price_snapshot: _cp, ...rest } = line
  return rest
}

/** Map-variant av {@link stripCustomerEconomicsLine} for linje-arrays. */
export function stripCustomerEconomicsLines<T extends { customer_price_snapshot: unknown }>(
  lines: readonly T[],
): Array<Omit<T, 'customer_price_snapshot'>> {
  return lines.map((l) => stripCustomerEconomicsLine(l))
}

/**
 * Rekursiv strip av alle tre kundepris-nøklene — uansett hvor dypt de ligger i
 * et objekt-/array-tre. Brukt på activity_log-metadata (nested
 * change_order/lines/consequence_lines-struktur) der en flat top-level-strip
 * ville lekke dypere kundepriser. Konsolidert fra den tidligere
 * stripCustomerKeysDeep i app/api/activity/route.ts.
 */
export function stripCustomerEconomicsDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripCustomerEconomicsDeep(item))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!CUSTOMER_PRICING_KEY_SET.has(k)) {
        out[k] = stripCustomerEconomicsDeep(v)
      }
    }
    return out
  }
  return value
}
