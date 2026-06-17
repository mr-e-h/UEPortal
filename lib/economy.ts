/**
 * Fakturerings-modulen: ÉN kilde for «klart til / gjenstår å fakturere»-
 * formelen som ellers blir reimplementert per side (faktura-siden og
 * prosjektdetaljen). Ren funksjon over tall — ingen I/O, ingen kundepris.
 *
 * Tallene her er ren UE-kost: godkjent produsert kost + godkjente EM-er,
 * minus det UE allerede har fakturert. Kundepris (customer_price_snapshot,
 * total_customer_value, profit) skal ALDRI inn i denne beregningen.
 */

interface ReadyToInvoiceInput {
  /** Godkjent produsert kost (kr) — Σ godkjent mengde × UE-kostpris. */
  approvedWork: number
  /** Sum UE-kost på godkjente endringsmeldinger (kr). */
  approvedChangeOrders: number
  /** Allerede fakturert beløp (kr). */
  invoiced: number
}

/**
 * Klart til fakturering (kr) = godkjent kost + godkjente EM − fakturert.
 *
 * Kan bli negativ når UE har fakturert mer enn det som så langt er godkjent
 * (f.eks. à konto / forskudd) — det er bevisst og skal vises rødt av kalleren,
 * ikke klippes til 0 her.
 */
export function readyToInvoice({ approvedWork, approvedChangeOrders, invoiced }: ReadyToInvoiceInput): number {
  return approvedWork + approvedChangeOrders - invoiced
}
