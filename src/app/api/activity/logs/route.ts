import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/activity/logs?machineCode=XXX&limit=100&hours=24
// Returns activity logs for a machine
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const machineCode = (searchParams.get('machineCode') || '').toUpperCase().trim()
    const limit = parseInt(searchParams.get('limit') || '100')
    const hours = parseInt(searchParams.get('hours') || '24')

    if (!machineCode) {
      return NextResponse.json({ error: 'machineCode is required' }, { status: 400 })
    }

    const machine = await db.unattendedMachine.findUnique({ where: { machineCode } })
    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const logs = await db.activityLog.findMany({
      where: {
        machineId: machine.id,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })

    return NextResponse.json({ logs })
  } catch (err: any) {
    console.error('GET /api/activity/logs error:', err)
    return NextResponse.json({ error: err?.message ?? 'Internal error' }, { status: 500 })
  }
}
