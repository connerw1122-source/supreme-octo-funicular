import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/activity/apps?machineCode=XXX&hours=24
// Returns app usage aggregated by app name
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const machineCode = (searchParams.get('machineCode') || '').toUpperCase().trim()
    const hours = parseInt(searchParams.get('hours') || '24')

    if (!machineCode) {
      return NextResponse.json({ error: 'machineCode is required' }, { status: 400 })
    }

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const apps = await db.appUsage.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      take: 500,
    })

    // Aggregate by appName
    const aggregated = new Map<string, { appName: string; category: string; totalDuration: number; lastTitle: string }>()
    for (const app of apps) {
      const existing = aggregated.get(app.appName)
      if (existing) {
        existing.totalDuration += app.duration
        existing.lastTitle = app.windowTitle || existing.lastTitle
      } else {
        aggregated.set(app.appName, {
          appName: app.appName,
          category: app.category,
          totalDuration: app.duration,
          lastTitle: app.windowTitle || '',
        })
      }
    }

    const result = Array.from(aggregated.values()).sort((a, b) => b.totalDuration - a.totalDuration)
    return NextResponse.json({ apps: result })
  } catch (err: any) {
    console.error('GET /api/activity/apps error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
