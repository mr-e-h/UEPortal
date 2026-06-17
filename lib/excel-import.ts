import { readJson, writeJson } from '@/lib/data'
import { isLumpSumCode } from '@/lib/lump-sum-codes'
import type { Product, ProjectBudgetLine } from '@/types'
import type { ParsedExcelLine } from '@/lib/excel'

function norm(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function importExcelLines(projectId: string, county: string, rawLines: ParsedExcelLine[]) {
  const products = await readJson<Product>('products.json')
  const budgetLines = await readJson<ProjectBudgetLine>('project_budget_lines.json')

  // Phase 1: merge duplicate rows only when name AND price match exactly.
  // Rows with same name but different prices are kept as separate line items.
  //
  // FASTPRIS-FELLE: rundsum-/fastpris-koder (lump-sum) får ALLE pris = 1 kr av
  // parseren (beløpet ligger i antall). Flere fastpris-linjer med samme navn —
  // f.eks. tre «Estimert pris for tilleggsarbeid» à 25000/19000/10324 — ville da
  // fått identisk navn+pris-nøkkel og kollapset til ÉN linje (antall summert).
  // Totalen blir riktig, men linjene forsvinner. Derfor tar vi med beløpet
  // (budget_quantity) i nøkkelen for lump-sum-linjer, så distinkte fastpriser
  // beholdes som egne linjer.
  const mergedMap = new Map<string, ParsedExcelLine>()
  for (const line of rawLines) {
    if (!line.product_name || line.unit_price <= 0) continue
    const lumpSumDiscriminator = isLumpSumCode(line.product_code) ? `__ls${line.budget_quantity}` : ''
    const key = `${norm(line.product_name)}__${line.unit_price}${lumpSumDiscriminator}`
    const existing = mergedMap.get(key)
    if (existing) {
      mergedMap.set(key, { ...existing, budget_quantity: existing.budget_quantity + line.budget_quantity })
    } else {
      mergedMap.set(key, { ...line })
    }
  }
  const lines = Array.from(mergedMap.values())

  let idBase = Date.now()
  let new_products = 0
  let added = 0
  let updated = 0

  // Track which budget line ids we've updated so we don't process them as duplicates later
  const updatedIds = new Set<string>()

  for (const line of lines) {
    const nameLower = norm(line.product_name)

    // Phase 2: find or create product (case/whitespace insensitive)
    let product = products.find((p) => norm(p.name) === nameLower)
    if (!product) {
      product = {
        id: String(idBase++),
        name: line.product_name.trim(),
        description: line.product_code,
        unit: 'stk',
        county,
        customer_price: line.unit_price,
        active: true,
      }
      products.push(product as Product)
      new_products++
    }

    // Phase 3: find ALL existing manual budget lines for this project+product
    const matchingIndices = budgetLines
      .map((bl, i) => ({ bl, i }))
      .filter(({ bl }) =>
        bl.project_id === projectId &&
        bl.product_id === product!.id &&
        (bl.source ?? 'manual') === 'manual' &&
        !updatedIds.has(bl.id)
      )
      .map(({ i }) => i)

    if (matchingIndices.length > 0) {
      // Prefer the one with a UE assignment; otherwise take the first
      const bestIdx =
        matchingIndices.find((i) => budgetLines[i].assigned_subcontractor_id != null) ??
        matchingIndices[0]

      budgetLines[bestIdx] = {
        ...budgetLines[bestIdx],
        budget_quantity: line.budget_quantity || 1,
        customer_price_snapshot: line.unit_price,
      }
      updatedIds.add(budgetLines[bestIdx].id)

      // Mark extra duplicates for removal
      for (const i of matchingIndices) {
        if (i !== bestIdx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(budgetLines as any[])[i] = null
        }
      }

      updated++
    } else {
      const newLine: ProjectBudgetLine = {
        id: String(idBase++),
        project_id: projectId,
        product_id: product!.id,
        budget_quantity: line.budget_quantity || 1,
        customer_price_snapshot: line.unit_price,
        assigned_subcontractor_id: null,
        subcontractor_cost_price_snapshot: 0,
        source: 'manual',
      }
      budgetLines.push(newLine)
      updatedIds.add(newLine.id)
      added++
    }
  }

  // Remove entries marked null (consolidated duplicates)
  const cleaned = budgetLines.filter((bl) => bl !== null)

  await writeJson('products.json', products)
  await writeJson('project_budget_lines.json', cleaned)

  return { imported: added + updated, added, updated, new_products }
}
