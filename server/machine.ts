import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { statfs, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { MachineView } from './types.ts'

const exec = promisify(execFile)

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMP_SRC = path.join(ROOT, 'server', 'helpers', 'temp.swift')
const TEMP_BIN = path.join(ROOT, '.cockpit-temp')

/** Fast enough to feel live, slow enough for a 2015 iPad to repaint. */
const TICK_MS = 3_000
const DISK_MS = 60_000
/** One history point per 30s, an hour deep. */
const HISTORY_STEP_MS = 30_000
const HISTORY_MAX = 120
/** The user data volume; `/` is the sealed system snapshot. */
const DATA_VOLUME = '/System/Volumes/Data'

interface CpuTimes {
  idle: number
  total: number
}

function cpuTimes(): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of os.cpus()) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.irq + t.idle
  }
  return { idle, total }
}

/**
 * The Mac itself: CPU, GPU, memory, disk and temperature. Everything here is
 * readable without admin rights — os counters, vm_stat, ioreg, statfs, and a
 * tiny Swift helper for the temperature sensors (built on first run; without
 * a Swift toolchain the board just shows no temperature).
 */
export class Machine {
  private view: MachineView = {
    model: os.cpus()[0]?.model.replace(/^Apple /, '') ?? 'Mac',
    cpu: null,
    gpu: null,
    temp: null,
    ram: null,
    disk: null,
    history: [],
  }
  private prev = cpuTimes()
  private timer: NodeJS.Timeout | null = null
  private diskTimer: NodeJS.Timeout | null = null
  private helper: ChildProcess | null = null
  private stopped = false
  private lastHistory = 0

  start(onChange: () => void): void {
    // Offline/demo hook: show saved readings instead of this Mac's own.
    const fixture = process.env.COCKPIT_MACHINE_FIXTURE
    if (fixture) {
      try {
        this.view = JSON.parse(readFileSync(fixture, 'utf8'))
        return
      } catch {
        /* unreadable fixture: fall through to live readings */
      }
    }
    const tick = async () => {
      await Promise.all([this.readCpu(), this.readGpu(), this.readRam()])
      this.record()
      onChange()
    }
    void this.readDisk()
    void tick()
    this.timer = setInterval(() => void tick(), TICK_MS)
    this.diskTimer = setInterval(() => void this.readDisk(), DISK_MS)
    void this.startTemp()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.diskTimer) clearInterval(this.diskTimer)
    this.helper?.kill()
  }

  current(): MachineView {
    return this.view
  }

  private async readCpu(): Promise<void> {
    const now = cpuTimes()
    const total = now.total - this.prev.total
    const idle = now.idle - this.prev.idle
    this.prev = now
    if (total > 0) this.view.cpu = Math.max(0, Math.min(100, (1 - idle / total) * 100))
  }

  private async readGpu(): Promise<void> {
    try {
      const { stdout } = await exec('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'])
      const m = stdout.match(/"Device Utilization %"=(\d+)/)
      this.view.gpu = m ? Number(m[1]) : null
    } catch {
      this.view.gpu = null
    }
  }

  private async readRam(): Promise<void> {
    try {
      const { stdout } = await exec('/usr/bin/vm_stat')
      const page = Number(stdout.match(/page size of (\d+) bytes/)?.[1] ?? 16384)
      const pages = (label: string) => Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0)
      // What Activity Monitor calls "memory used": app + wired + compressed.
      const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page
      this.view.ram = { used, total: os.totalmem() }
    } catch {
      this.view.ram = null
    }
  }

  private async readDisk(): Promise<void> {
    try {
      const s = await statfs(DATA_VOLUME)
      const total = s.blocks * s.bsize
      // Total minus available, so space taken by other volumes in the container counts.
      this.view.disk = { used: total - s.bavail * s.bsize, total }
    } catch {
      this.view.disk = null
    }
  }

  private record(): void {
    const now = Date.now()
    if (now - this.lastHistory < HISTORY_STEP_MS) return
    this.lastHistory = now
    const round = (n: number | null) => (n === null ? null : Math.round(n))
    const history = [...this.view.history, [now, round(this.view.cpu), round(this.view.gpu), round(this.view.temp)]]
    this.view.history = history.slice(-HISTORY_MAX) as MachineView['history']
  }

  /** Build the helper if it's missing or older than its source, then stream it. */
  private async startTemp(): Promise<void> {
    try {
      const [src, bin] = await Promise.all([stat(TEMP_SRC), stat(TEMP_BIN).catch(() => null)])
      if (!bin || bin.mtimeMs < src.mtimeMs) {
        await exec('swiftc', ['-O', '-o', TEMP_BIN, TEMP_SRC], { timeout: 180_000 })
      }
    } catch {
      return // no toolchain, or the build failed: no temperature
    }
    if (this.stopped) return
    const child = spawn(TEMP_BIN, [String(TICK_MS / 1000)], { stdio: ['ignore', 'pipe', 'ignore'] })
    this.helper = child
    let buf = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      const last = lines.filter(Boolean).pop()
      if (!last) return
      try {
        const t = JSON.parse(last).cpu
        if (typeof t === 'number') this.view.temp = t
      } catch {
        /* ignore a torn line */
      }
    })
    child.on('exit', () => {
      this.helper = null
      this.view.temp = null
    })
    child.on('error', () => {
      this.helper = null
    })
  }
}
