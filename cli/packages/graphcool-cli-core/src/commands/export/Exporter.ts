import { Client, Output, Config } from 'graphcool-cli-engine'
import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { repeat } from 'lodash'
import * as archiver from 'archiver'
import * as os from 'os'
const debug = require('debug')('Exporter')

export type FileType = 'nodes' | 'relations' | 'lists'

export interface ExportRequest {
  fileType: FileType
  cursor: ExportCursor
}

export interface ExportCursor {
  table: number
  row: number
  field: number
  array: number
}

export class Exporter {
  client: Client
  exportPath: string
  exportDir: string
  out: Output
  config: Config
  constructor(exportPath: string, client: Client, out: Output, config: Config) {
    this.client = client
    this.exportPath = exportPath
    this.config = config
    this.exportDir = path.join(config.cwd, '.export')
    this.out = out
  }

  async download(projectId: string) {
    this.makeDirs()
    await this.downloadFiles('nodes', projectId)
    await this.downloadFiles('lists', projectId)
    await this.downloadFiles('relations', projectId)
    await this.zipIt()
    fs.removeSync(this.exportDir)
  }

  zipIt() {
    return new Promise((resolve, reject) => {
      this.out.action.start(`Zipping export`)
      const before = Date.now()
      const archive = archiver('zip')
      archive.directory(this.exportDir, false)
      const output = fs.createWriteStream(this.exportPath)
      archive.pipe(output)
      output.on('close', () => {
        console.log(archive.pointer() + ' total bytes')
        this.out.action.stop(chalk.cyan(`${Date.now() - before}ms`))
        resolve()
      })
      archive.finalize()
    })
  }

  makeDirs() {
    fs.mkdirpSync(path.join(this.exportDir, 'nodes/'))
    fs.mkdirpSync(path.join(this.exportDir, 'lists/'))
    fs.mkdirpSync(path.join(this.exportDir, 'relations/'))
  }

  async downloadFiles(fileType: FileType, projectId: string) {
    const before = Date.now()
    this.out.action.start(`Downloading ${fileType}`)

    let cursor: ExportCursor = {
      table: 0,
      row: 0,
      field: 0,
      array: 0,
    }

    const cursorSum = c =>
      Object.keys(c).reduce((acc, curr) => acc + c[curr], 0)

    const leadingZero = (n: number, zeroes: number = 6) =>
      repeat('0', Math.max(zeroes - String(n).length, 0)) + n

    let count = 1
    const filesDir = path.join(this.exportDir, `${fileType}/`)
    while (cursorSum(cursor) >= 0) {
      const data = await this.client.download(
        projectId,
        JSON.stringify({
          fileType,
          cursor,
        }),
      )

      if (!data.out || !data.out.jsonElements) {
        this.out.action.stop()
        this.out.warn(
          `The download of ${fileType} failed. You may get fragmented data. Request ID: ${
            data.requestId
          }`,
        )
        return
      }

      const jsonString = JSON.stringify({
        valueType: fileType,
        values: data.out.jsonElements,
      })

      fs.writeFileSync(
        path.join(filesDir, `${leadingZero(count)}.json`),
        jsonString,
      )

      cursor = data.cursor
      count++
    }

    this.out.action.stop(chalk.cyan(`${Date.now() - before}ms`))
  }
}
