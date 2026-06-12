/**
 * «Eksporter PDF»-mønsteret for et utsnitt av en side: marker utsnittet med
 * className="print-area", kall printArea() — globals.css sørger for at kun
 * print-area-treet er synlig i utskriften (nettleserens PDF-dialog).
 */
export function printArea() {
  const body = document.body
  body.classList.add('printing-area')
  const done = () => {
    body.classList.remove('printing-area')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  // Liten utsettelse så React rekker å rendre print-tilstand først.
  setTimeout(() => window.print(), 80)
}
