import { once } from "node:events"
import { PassThrough } from "node:stream"
import { pipeline } from "node:stream/promises"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import type { ServerResponse } from "node:http"
import type { HistoryItem, HistoryReportFormat } from "../../../../shared/contracts.ts"

export const reportTypes = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
} satisfies Record<HistoryReportFormat, string>

type ReportRows = AsyncIterable<HistoryItem<Date>>

const headings = ["Phone number", "Result", "Channel", "Snapshot", "Checked (UTC)"]
const excelMaxRows = 1_048_576

function values(row: HistoryItem<Date>) {
  return [
    row.masked_phone,
    row.exists_in_registry ? "Match found" : "No match",
    row.channel === "api" ? "API" : "Workspace",
    row.generation_id,
    new Date(row.checked_at).toISOString().slice(0, 19).replace("T", " "),
  ]
}

function csvField(value: string) {
  // Quoting alone does not stop spreadsheet apps from evaluating CSV formulas.
  const safe = /^\s*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

async function csv(stream: PassThrough, rows: ReportRows, signal: AbortSignal) {
  stream.write(`\uFEFF${headings.map(csvField).join(",")}\r\n`)
  for await (const row of rows) {
    if (!stream.write(`${values(row).map(csvField).join(",")}\r\n`)) await once(stream, "drain", { signal })
  }
  stream.end()
}

async function xlsx(stream: PassThrough, rows: ReportRows, signal: AbortSignal) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true })
  let sheetNumber = 0
  function addSheet() {
    const sheet = workbook.addWorksheet(++sheetNumber === 1 ? "History" : `History ${sheetNumber}`, {
      views: [{ state: "frozen", ySplit: 1 }],
    })
    const widths = [19, 17, 14, 22, 23]
    sheet.columns = headings.map((header, index) => ({ header, width: widths[index] }))
    const header = sheet.getRow(1)
    header.font = { bold: true, color: { argb: "FFFFFFFF" } }
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23314E" } }
    header.commit()
    return sheet
  }
  let sheet = addSheet()
  let rowCount = 1
  for await (const row of rows) {
    if (rowCount === excelMaxRows) {
      sheet.commit()
      sheet = addSheet()
      rowCount = 1
    }
    sheet.addRow(values(row)).commit()
    rowCount++
    if (stream.writableNeedDrain) await once(stream, "drain", { signal })
  }
  await workbook.commit()
}

async function pdf(stream: PassThrough, rows: ReportRows, signal: AbortSignal) {
  const doc = new PDFDocument({ size: "A4", margin: 44, autoFirstPage: false, info: { Title: "Screening history" } })
  doc.on("error", error => stream.destroy(error))
  doc.pipe(stream)
  const widths = [119, 94, 79, 95, 119]
  const left = 44
  const tableWidth = widths.reduce((total, width) => total + width, 0)
  let page = 0
  let y = 0
  let count = 0

  function line(cells: string[], at: number, color: string, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(color)
    let x = left
    cells.forEach((cell, index) => {
      doc.text(cell, x + 8, at, { width: widths[index] - 16, height: 13, ellipsis: true })
      x += widths[index]
    })
  }

  function addPage() {
    doc.addPage()
    doc.font("Helvetica-Bold").fontSize(24).fillColor("#172443").text("Screening history", left, 45)
    doc.font("Helvetica").fontSize(10).fillColor("#4F5D77").text("DNC Screening / Synthetic data", left, 78)
    doc.rect(left, 105, tableWidth, 23).fill("#23314E")
    line(headings, 112, "#FFFFFF", true)
    doc.font("Helvetica").fontSize(9).fillColor("#4F5D77")
      .text(`Page ${++page}`, left, 782, { width: tableWidth, align: "right", lineBreak: false })
    y = 128
  }

  try {
    addPage()
    for await (const row of rows) {
      if (y + 20 > 756) addPage()
      if (count % 2 === 0) doc.rect(left, y, tableWidth, 20).fill("#F0F3F8")
      line(values(row), y + 6, "#172443")
      y += 20
      count++
      if (stream.writableNeedDrain) await once(stream, "drain", { signal })
    }
    if (!count) doc.font("Helvetica").fontSize(10).fillColor("#4F5D77").text("No matching lookups.", left + 8, y + 13)
    doc.end()
  } catch (error) {
    doc.destroy()
    throw error
  }
}

const writers = { csv, xlsx, pdf }

export async function writeHistoryReport(format: HistoryReportFormat, rows: ReportRows, response: ServerResponse, signal: AbortSignal) {
  const stream = new PassThrough()
  const output = pipeline(stream, response)
  try {
    await Promise.race([writers[format](stream, rows, signal), output])
    await output
  } finally {
    stream.destroy()
  }
}
